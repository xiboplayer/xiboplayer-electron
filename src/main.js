/**
 * Xibo Player - Electron Kiosk Wrapper
 *
 * Production-ready Electron wrapper that serves the PWA player
 * in a fullscreen kiosk mode with all necessary security and features.
 *
 * Architecture:
 * - Express server serves PWA dist files on localhost
 * - XMDS/REST proxy routes handle CMS CORS issues
 * - BrowserWindow loads the PWA from localhost (enables Service Worker)
 * - Preload script exposes minimal API for Electron-specific features
 * - Session-level CORS headers for direct CMS requests from the renderer
 */

const { app, BrowserWindow, ipcMain, powerSaveBlocker, Menu, Tray, dialog, nativeImage, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { promisify } = require('util');
const AutoLaunch = require('electron-auto-launch');

const execPromise = promisify(exec);
const os = require('os');

/**
 * Parse a --key=value CLI argument.
 * @param {string} key - Argument name (without --)
 * @param {'string'|'int'} [type='string'] - Value type
 * @param {*} [defaultValue=null] - Default if not found
 */
function parseArgument(key, type = 'string', defaultValue = null) {
  const arg = process.argv.find(a => a.startsWith(`--${key}=`));
  if (!arg) return defaultValue;
  const value = arg.split('=').slice(1).join('=');
  return type === 'int' ? parseInt(value, 10) : value;
}

/**
 * Remove directories from an Electron session path.
 * @param {string} sessionDir - Base session directory
 * @param {string[]} dirNames - Subdirectory names to remove
 */
function clearSessionDirectories(sessionDir, dirNames) {
  for (const dir of dirNames) {
    try { fs.rmSync(path.join(sessionDir, dir), { recursive: true, force: true }); } catch (_) {}
  }
}

/** CORS response headers injected into all Electron webRequest responses */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ['*'],
  'Access-Control-Allow-Methods': ['GET, POST, PUT, DELETE, OPTIONS'],
  'Access-Control-Allow-Headers': ['Content-Type, SOAPAction, Authorization, Accept'],
  'Access-Control-Max-Age': ['86400'],
};
const CORS_HEADER_KEYS = new Set(Object.keys(CORS_HEADERS).map(k => k.toLowerCase()));

// Parse --instance=NAME early (before app paths are used)
const instanceName = parseArgument('instance', 'string', '');
const instanceSuffix = instanceName ? `electron-${instanceName}` : 'electron';

// XDG-compliant paths: config in ~/.config, data in ~/.local/share
// Config (config.json, preferences): ~/.config/xiboplayer/electron[-NAME]/
app.setPath('userData', path.join(app.getPath('appData'), 'xiboplayer', instanceSuffix));
// Session data (Cache, IndexedDB, Service Worker, cookies): ~/.local/share/xiboplayer/electron[-NAME]/
const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
app.setPath('sessionData', path.join(dataHome, 'xiboplayer', instanceSuffix));

// GPU acceleration flags — must be set before app.whenReady()
// Electron 40+ (Chromium 144) auto-detects Wayland via ozone-platform-hint=auto.
// Do NOT force --ozone-platform=wayland — it breaks Vulkan/GL negotiation.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-features',
  'AcceleratedVideoDecodeLinuxGL,AcceleratedVideoDecodeLinuxZeroCopyGL,' +
  'VaapiVideoDecoder,VaapiVideoEncoder,VaapiOnNvidiaGPUs,' +
  'AcceleratedVideoEncoder,CanvasOopRasterization');

// Prevent GPU crash and renderer freeze when screen is locked/off
app.commandLine.appendSwitch('disable-gpu-watchdog');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Adaptive memory tuning — scale V8 heap and raster threads to hardware.
// Player JS is lightweight; the big consumers are video decode buffers (VAAPI)
// and Chromium's GPU compositing, which we can't cap without losing HW accel.
const totalRAM_GB = Math.round(os.totalmem() / (1024 ** 3));
const cpuCount = os.cpus().length;

let maxOldSpaceMB, rasterThreads;
if (totalRAM_GB <= 1) {
  maxOldSpaceMB = 128;
  rasterThreads = 1;
} else if (totalRAM_GB <= 2) {
  maxOldSpaceMB = 192;
  rasterThreads = 2;
} else if (totalRAM_GB <= 4) {
  maxOldSpaceMB = 256;
  rasterThreads = Math.min(cpuCount, 2);
} else if (totalRAM_GB <= 8) {
  maxOldSpaceMB = 512;
  rasterThreads = Math.min(cpuCount, 4);
} else {
  maxOldSpaceMB = 768;
  rasterThreads = Math.min(cpuCount, 4);
}

app.commandLine.appendSwitch('js-flags', `--max-old-space-size=${maxOldSpaceMB}`);
app.commandLine.appendSwitch('num-raster-threads', String(rasterThreads));
app.commandLine.appendSwitch('gpu-rasterization-msaa-sample-count', '0');
console.log(`[Memory] ${totalRAM_GB}GB RAM, ${cpuCount} CPUs → V8 heap ${maxOldSpaceMB}MB, ${rasterThreads} raster threads`);

// Version
const APP_VERSION = '0.2.1';

// ─── Configuration ──────────────────────────────────────────────────
// Single config.json — sparse, user-provided overrides only.
// Defaults live here in code; generated values (hardwareKey) stay in
// PWA localStorage/IndexedDB.
const CONFIG_DEFAULTS = {
  cmsUrl: '',
  cmsKey: '',
  displayName: '',
  serverPort: 8765,
  kioskMode: true,
  autoLaunch: false,
  fullscreen: true,
  hideMouseCursor: true,
  preventSleep: true,
  allowShellCommands: false,
  logLevel: '',
  relaxSslCerts: true,
  playerApiBase: '',
  width: 1920,
  height: 1080,
  controls: {
    keyboard: {
      debugOverlays: false,
      setupKey: false,
      playbackControl: false,
      videoControls: false,
    },
    mouse: {
      statusBarOnHover: false,
    },
  },
};

const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
const configFilePath = path.join(configDir, 'xiboplayer', instanceSuffix, 'config.json');
const pwaVersionPath = path.join(configDir, 'xiboplayer', instanceSuffix, '.pwa-version');

// Load config: defaults ← system template ← config.json on disk
const SYSTEM_CONFIG = '/usr/share/xiboplayer-electron/config.json';
let config = { ...CONFIG_DEFAULTS };
try {
  const fileConfig = JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
  Object.assign(config, fileConfig);
  console.log(`[Config] Loaded from ${configFilePath}: cmsUrl=${config.cmsUrl || '(empty)'}`);
} catch (err) {
  if (err.code === 'ENOENT') {
    // First run — copy system default config if available (RPM/DEB install)
    try {
      const sysConfig = fs.readFileSync(SYSTEM_CONFIG, 'utf8');
      fs.mkdirSync(path.dirname(configFilePath), { recursive: true });
      fs.writeFileSync(configFilePath, sysConfig);
      Object.assign(config, JSON.parse(sysConfig));
      console.log(`[Config] Created ${configFilePath} from ${SYSTEM_CONFIG}`);
    } catch (_) {
      // No system config — running from source or dev; use defaults
    }
  } else {
    console.warn(`[Config] Failed to read config.json: ${err.message}`);
  }
}

/**
 * Save updates to config.json — only persists keys already on disk
 * plus the new keys. Never injects defaults or generated values.
 */
function saveConfig(updates) {
  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(configFilePath, 'utf8')); } catch (_) {}
  Object.assign(existing, updates);
  // Ensure the config directory exists
  fs.mkdirSync(path.dirname(configFilePath), { recursive: true });
  fs.writeFileSync(configFilePath, JSON.stringify(existing, null, 2));
  Object.assign(config, updates);
}

/** Read the cached PWA version from .pwa-version file */
function readPwaVersion() {
  try { return fs.readFileSync(pwaVersionPath, 'utf8').trim(); } catch (_) { return ''; }
}

/** Write the PWA version to .pwa-version file */
function writePwaVersion(version) {
  fs.mkdirSync(path.dirname(pwaVersionPath), { recursive: true });
  fs.writeFileSync(pwaVersionPath, version);
}

// Auto-launch configuration
const autoLauncher = new AutoLaunch({
  name: 'Xibo Player',
  isHidden: false,
});

// Global state
let mainWindow = null;
let tray = null;
let expressServer = null;
let powerSaveBlockerId = null;
const isDev = process.argv.includes('--dev');
const noKiosk = process.argv.includes('--no-kiosk');

// Parse CLI arguments for auto-config injection (non-persistent, in-memory only)
const cliPort = parseArgument('port', 'int', null);
const cliCmsUrl = parseArgument('cms-url');
const cliCmsKey = parseArgument('cms-key');
const cliDisplayName = parseArgument('display-name');
if (cliCmsUrl) config.cmsUrl = cliCmsUrl;
if (cliCmsKey) config.cmsKey = cliCmsKey;
if (cliDisplayName) config.displayName = cliDisplayName;

// No CMS URL → unconfigured.
// Wipe stale session data so the PWA shows the setup screen
// instead of booting from a ghost config left by a previous session.
if (!config.cmsUrl) {
  clearSessionDirectories(app.getPath('sessionData'), ['Local Storage', 'IndexedDB', 'Service Worker', 'Cache', 'Code Cache']);
  console.log('[Config] Unconfigured — cleared stale session data');
}

// Parse --pwa-path=/path/to/dist for local development builds
const pwaPathArg = parseArgument('pwa-path');

/**
 * Get the path to PWA dist files.
 * Priority: --pwa-path CLI arg > node_modules (production / installed)
 */
function getPwaPath() {
  if (pwaPathArg) return pwaPathArg;
  return path.join(__dirname, '../node_modules/@xiboplayer/pwa/dist');
}

/**
 * Track the bundled PWA version.  On version change, only clear Code Cache
 * (V8 bytecode compiled from old JS — can cause crashes with new code).
 * Service Worker and Cache are NOT wiped: the SW self-updates on install,
 * media lives in ContentStore/IndexedDB, and the kiosk may be offline.
 */
async function clearStaleServiceWorker() {
  try {
    const pwaPath = getPwaPath();
    const pkgPath = path.join(pwaPath, '../package.json');
    const pwaVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    const lastVersion = readPwaVersion();

    if (lastVersion && lastVersion !== pwaVersion) {
      console.log(`[SW-Clean] PWA version changed: ${lastVersion} → ${pwaVersion}`);
      const sessionDir = app.getPath('sessionData');
      // Only clear Code Cache — V8 bytecode compiled from old JS
      clearSessionDirectories(sessionDir, ['Code Cache']);
      console.log('[SW-Clean] Cleared Code Cache (SW and media cache preserved)');
    } else if (!lastVersion) {
      console.log(`[SW-Clean] First run, recording PWA version ${pwaVersion}`);
    }
    writePwaVersion(pwaVersion);
  } catch (err) {
    console.warn('[SW-Clean] Version check failed (non-fatal):', err.message);
  }
}

/**
 * Create and configure the Express server to serve PWA files.
 * Uses @xiboplayer/proxy for CORS proxy routes and PWA static serving.
 */
async function createExpressServer() {
  const serverPort = cliPort || config.serverPort;
  const pwaPath = getPwaPath();

  console.log(`[Express] PWA path: ${pwaPath}`);
  console.log(`[Express] Starting server on port: ${serverPort}`);

  // Extract PWA config — shared helper filters out common shell keys,
  // we only add Electron-specific extras here.
  const { extractPwaConfig, computeCmsId } = await import('@xiboplayer/utils/config');
  const pwaConfig = extractPwaConfig(config, ['autoLaunch', 'allowShellCommands']);

  // Inject CMS ID for per-CMS cache namespacing
  if (pwaConfig && config.cmsUrl) {
    const cmsId = computeCmsId(config.cmsUrl);
    if (cmsId) pwaConfig.cmsId = cmsId;
  }

  if (config.relaxSslCerts) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const { createProxyApp } = await import('@xiboplayer/proxy');
  const dataDir = app.getPath('sessionData');

  // Forward proxy logs to renderer DevTools via IPC.
  // The sink receives { level, name, args } from @xiboplayer/utils logger.
  const onLog = ({ level, name, args }) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('proxy-log', { level, name, args });
    }
  };

  const expressApp = createProxyApp({
    pwaPath, appVersion: APP_VERSION,
    pwaConfig,
    configFilePath, dataDir, onLog,
    allowShellCommands: !!config.allowShellCommands,
  });

  // Start server
  expressServer = expressApp.listen(serverPort, 'localhost', () => {
    console.log(`[Express] Server running on http://localhost:${serverPort}`);
  });

  expressServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[Express] Port ${serverPort} is already in use. Try --port=XXXX`);
      dialog.showErrorBox(
        'Port in use',
        `Port ${serverPort} is already in use.\nTry running with --port=XXXX or stop the other process.`
      );
      app.quit();
    } else {
      console.error('[Express] Server error:', err);
    }
  });

  return serverPort;
}

/**
 * Create the main browser window with kiosk mode settings
 */
function createWindow() {
  const kioskMode = noKiosk ? false : config.kioskMode;
  const fullscreen = config.fullscreen;
  const { width, height } = config;

  console.log(`[Window] Creating window (kiosk: ${kioskMode}, fullscreen: ${fullscreen}, dev: ${isDev})`);

  mainWindow = new BrowserWindow({
    width,
    height,
    fullscreen,
    kiosk: kioskMode,
    frame: !kioskMode,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Allow service worker registration from localhost
      // webSecurity stays enabled (default) - CORS handled via proxy + session headers
    },
  });

  // ─── Session-level CORS handling ────────────────────────────────────
  // 1. Intercept OPTIONS preflight requests and return 200 with CORS headers
  //    (the CMS may not handle OPTIONS, which causes CORS preflight failures)
  // 2. Add CORS headers to all other responses from external servers
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['*://*/*'] },
    (details, callback) => {
      // For OPTIONS preflight requests to external servers, we let them through
      // but will fix the response in onHeadersReceived
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};

    // Remove any existing CORS headers to prevent duplication
    // (e.g. SWAG/nginx already adds Access-Control-Allow-Origin: *,
    //  and a second * from us makes the browser reject the response)
    for (const key of Object.keys(headers)) {
      if (CORS_HEADER_KEYS.has(key.toLowerCase())) delete headers[key];
    }

    // Set CORS headers (single source of truth)
    Object.assign(headers, CORS_HEADERS);

    // For OPTIONS preflight responses that return non-2xx status,
    // override to 200 so the browser CORS check passes
    if (details.method === 'OPTIONS' && details.statusCode >= 400) {
      callback({
        responseHeaders: headers,
        statusLine: 'HTTP/1.1 200 OK',
      });
      return;
    }

    callback({ responseHeaders: headers });
  });

  console.log('[Session] CORS headers and preflight handling configured');

  // ─── Accept invalid certificates for media/stream URLs ──────────────
  // Digital signage often loads HLS streams or media from servers with
  // self-signed or expired certificates. Enabled by default (relaxSslCerts: true)
  // because self-signed certs on media streams are common in signage deployments.
  // Set to false in config.json to enforce strict SSL for all URLs.
  // CMS API calls always require valid certificates regardless of this setting.
  if (config.relaxSslCerts) {
    const cmsHost = config.cmsUrl ? new URL(config.cmsUrl).host : null;
    const certWarned = new Set(); // Deduplicate: warn once per host

    app.on('certificate-error', (event, _webContents, url, error, _certificate, callback) => {
      try {
        const urlHost = new URL(url).host;
        // Never bypass cert errors for CMS or localhost — those must be valid
        if (cmsHost && urlHost === cmsHost) {
          callback(false);
          return;
        }
        if (urlHost === 'localhost' || urlHost.startsWith('127.')) {
          callback(false);
          return;
        }
        // Accept invalid certs for media/stream URLs — warn once per host
        event.preventDefault();
        callback(true);

        if (!certWarned.has(urlHost)) {
          certWarned.add(urlHost);
          console.warn(`[Security] Accepted invalid certificate for media URL: ${url} (${error})`);
          // Notify renderer to show warning in overlay
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('cert-warning', { url, host: urlHost, error });
          }
        }
      } catch {
        callback(false);
      }
    });

    console.log('[Session] Certificate handling configured (relaxSslCerts: media streams permissive, CMS: strict)');
  }

  // ─── Forward Service Worker console logs to main process ────────────
  // SW logs don't appear in webContents.on('console-message'). This
  // captures them so they show up in /tmp/electron-pwa.log alongside
  // renderer logs, making download/chunk debugging visible.
  mainWindow.webContents.session.serviceWorkers.on('console-message', (_event, details) => {
    const level = details.logLevel || 'info';
    const prefix = level === 'error' ? '[SW ERROR]' : level === 'warning' ? '[SW WARN]' : '[SW]';
    console.log(`${prefix} ${details.message}`);
  });

  // ─── Auto-approve permissions (no dialogs in kiosk mode) ─────────────
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['geolocation', 'notifications', 'media', 'mediaKeySystem', 'fullscreen'];
    callback(allowed.includes(permission));
  });

  // ─── Auto-approve screen capture (no permission dialog) ──────────────
  // If the PWA calls getDisplayMedia() (e.g. before electronAPI is ready),
  // auto-select the BrowserWindow as the capture source instead of showing
  // Chrome's screen-sharing picker dialog.
  mainWindow.webContents.session.setDisplayMediaRequestHandler(async (_request, callback) => {
    const sources = await desktopCapturer.getSources({ types: ['window'] });
    // Prefer our own window; fall back to first available source
    const selfSource = sources.find(s => s.name === mainWindow.getTitle()) || sources[0];
    callback({ video: selfSource, audio: 'loopback' });
  });

  // Application menu — accelerators work on Wayland (unlike globalShortcut)
  const menuTemplate = [
    {
      label: 'Player',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+Shift+R', click: () => mainWindow.reload() },
        { type: 'separator' },
        {
          label: 'Restart',
          click: () => { app.relaunch(); app.isQuitting = true; app.quit(); },
        },
        {
          label: 'Exit Player',
          accelerator: 'CmdOrCtrl+Q',
          click: () => { app.isQuitting = true; app.quit(); },
        },
      ],
    },
  ];
  if (isDev) {
    menuTemplate.push({
      label: 'Dev',
      submenu: [
        { label: 'Toggle DevTools', accelerator: 'CmdOrCtrl+Shift+I', click: () => mainWindow.webContents.toggleDevTools() },
      ],
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
  mainWindow.setAutoHideMenuBar(true);

  // Load PWA from local server at /player/
  // In dev mode, enable DEBUG logging via URL param (logger defaults to WARNING)
  const serverPort = cliPort || config.serverPort;
  const logLevel = isDev ? 'DEBUG' : (config.logLevel || '');
  const logParam = logLevel ? `?logLevel=${logLevel}` : '';
  const url = `http://localhost:${serverPort}/player/${logParam}`;

  console.log(`[Window] Loading URL: ${url}`);

  // CMS config injection is now handled server-side by @xiboplayer/proxy.
  // The proxy injects a <script> into index.html that pre-seeds localStorage
  // before the PWA loads, eliminating the race condition with did-finish-load.

  mainWindow.loadURL(url);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // Hide mouse cursor after inactivity (digital signage mode)
    if (config.hideMouseCursor) {
      setupCursorHiding();
    }
  });

  // Let Alt+F4 / window-manager close quit cleanly
  mainWindow.on('close', () => {
    app.isQuitting = true;
  });

  // Open DevTools in dev mode
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // ─── Navigation protection ─────────────────────────────────────────
  // Allow navigation within the local server (including setup.html, index.html)
  // Block navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, navUrl) => {
    const serverPort = cliPort || config.serverPort;
    const allowedOrigin = `http://localhost:${serverPort}`;

    if (!navUrl.startsWith(allowedOrigin)) {
      console.log('[Window] Blocked navigation to:', navUrl);
      event.preventDefault();
    }
  });

  // Handle new window requests (open in default browser)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });

  // Log renderer console output to main process console (useful for debugging)
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (true) { // TODO: revert to (isDev || level >= 2) once startup is stable
      // Filter out upstream XMR framework bug: console.debug(event) logs "[object MessageEvent]"
      if (message === '[object MessageEvent]') return;
      const prefix = level === 3 ? '[Renderer ERROR]' : level === 2 ? '[Renderer WARN]' : '[Renderer]';
      console.log(`${prefix} ${message}`);
    }
  });



  // Handle renderer crashes
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[Window] Render process gone:', details.reason, details.exitCode);
    if (details.reason !== 'clean-exit') {
      console.log('[Window] Reloading after crash...');
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload();
        }
      }, 3000);
    }
  });

  return mainWindow;
}

/**
 * Setup cursor hiding after 5 seconds of mouse inactivity
 */
function setupCursorHiding() {
  let cursorTimeout = null;
  let cursorHidden = false;

  const hideCursor = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.insertCSS('html.cursor-hidden, html.cursor-hidden * { cursor: none !important; }')
        .then((key) => {
          mainWindow.webContents.executeJavaScript('document.documentElement.classList.add("cursor-hidden")');
          cursorHidden = true;
        })
        .catch(() => {});
    }
  };

  const showCursor = () => {
    if (cursorHidden && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript('document.documentElement.classList.remove("cursor-hidden")')
        .catch(() => {});
      cursorHidden = false;
    }
  };

  const resetCursorTimeout = () => {
    showCursor();
    clearTimeout(cursorTimeout);
    cursorTimeout = setTimeout(hideCursor, 5000);
  };

  // Inject mousemove listener into the renderer page
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(`
      document.addEventListener('mousemove', () => {
        if (window.electronAPI && window.electronAPI.resetCursorTimeout) {
          window.electronAPI.resetCursorTimeout();
        }
      });
    `).catch(() => {});

  });

  ipcMain.on('reset-cursor-timeout', resetCursorTimeout);

  // Start initial timeout
  cursorTimeout = setTimeout(hideCursor, 5000);
}

/**
 * Prevent system display from sleeping (digital signage must stay on)
 */
function preventSystemSleep() {
  if (config.preventSleep) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
    console.log(`[PowerSaver] Display sleep prevented (ID: ${powerSaveBlockerId})`);
  }
}

/**
 * Create system tray with control menu
 */
function createSystemTray() {
  const iconPath = path.join(__dirname, '../resources/icon.png');

  try {
    tray = new Tray(iconPath);
  } catch (err) {
    // Tray creation can fail in headless environments
    console.warn('[Tray] Failed to create system tray:', err.message);
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: `Xibo Player v${APP_VERSION}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Show Player',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: 'Reload Player',
      click: () => {
        if (mainWindow) {
          mainWindow.reload();
        }
      },
    },
    {
      label: 'Restart Player',
      click: () => {
        app.relaunch();
        app.isQuitting = true;
        app.quit();
      },
    },
    { type: 'separator' },
    {
      label: 'Configuration',
      click: () => {
        showConfigDialog();
      },
    },
    {
      label: 'Toggle DevTools',
      visible: isDev,
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.toggleDevTools();
        }
      },
    },
    {
      label: 'Auto-start on Boot',
      type: 'checkbox',
      checked: config.autoLaunch,
      click: (menuItem) => {
        toggleAutoLaunch(menuItem.checked);
      },
    },
    { type: 'separator' },
    {
      label: 'Exit Player',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.setToolTip(`Xibo Player v${APP_VERSION}`);
}

/**
 * Toggle auto-launch on system boot
 */
async function toggleAutoLaunch(enable) {
  try {
    if (enable) {
      await autoLauncher.enable();
      saveConfig({ autoLaunch: true });
      console.log('[AutoLaunch] Enabled');
    } else {
      await autoLauncher.disable();
      saveConfig({ autoLaunch: false });
      console.log('[AutoLaunch] Disabled');
    }
  } catch (error) {
    console.error('[AutoLaunch] Error:', error);
  }
}

/**
 * Show configuration dialog
 */
function showConfigDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'Configuration',
    message: 'Xibo Player Configuration',
    detail: `CMS URL: ${config.cmsUrl || 'Not set (configured in PWA setup)'}
Server Port: ${config.serverPort}
Kiosk Mode: ${config.kioskMode ? 'Enabled' : 'Disabled'}
Version: ${APP_VERSION}

Configuration is managed through the PWA setup page.
Config file: ${configFilePath}

User data: ${app.getPath('userData')}`,
    buttons: ['OK', 'Open Config Folder'],
  }).then((result) => {
    if (result.response === 1) {
      require('electron').shell.openPath(app.getPath('userData'));
    }
  });
}

/**
 * Setup global keyboard shortcuts
 */
function setupKeyboardShortcuts() {
  // Use before-input-event for shortcuts not covered by Menu accelerators.
  // (globalShortcut silently fails on Wayland)
  if (!mainWindow) return;

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if ((input.control || input.meta) && input.shift && input.key === 'F12') {
      console.log('[Shortcut] Showing system tray menu');
      if (tray) tray.popUpContextMenu();
      event.preventDefault();
    }
  });
}

/**
 * Setup IPC handlers for communication with the renderer process
 */
function setupIpcHandlers() {
  // Get Electron-side configuration
  ipcMain.handle('get-config', () => {
    return {
      cmsUrl: config.cmsUrl,
      serverPort: config.serverPort,
    };
  });

  // Set Electron-side configuration (persists to config.json)
  ipcMain.handle('set-config', (_event, updates) => {
    const allowed = ['cmsUrl', 'cmsKey', 'displayName', 'serverPort'];
    const filtered = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) filtered[key] = updates[key];
    }
    if (Object.keys(filtered).length > 0) {
      saveConfig(filtered);
      console.log('[Config] Configuration updated:', filtered);
    }
    return true;
  });

  // Get system information for hardware key generation
  ipcMain.handle('get-system-info', () => {
    const os = require('os');
    // Get MAC address of first non-internal interface with a real MAC
    let macAddress = 'n/a';
    const nets = os.networkInterfaces();
    for (const iface of Object.values(nets)) {
      for (const cfg of iface) {
        if (!cfg.internal && cfg.mac && cfg.mac !== '00:00:00:00:00:00') {
          macAddress = cfg.mac;
          break;
        }
      }
      if (macAddress !== 'n/a') break;
    }
    return {
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      hostname: os.hostname(),
      totalMemory: os.totalmem(),
      macAddress,
      electronVersion: process.versions.electron,
      chromeVersion: process.versions.chrome,
    };
  });

  // Capture screenshot using Electron's native API
  // Much better than html2canvas: captures everything including video frames,
  // composited layers, WebGL, etc. with zero DOM manipulation.
  ipcMain.handle('capture-screenshot', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return null;
    }

    try {
      const image = await mainWindow.webContents.capturePage();
      // Return as JPEG base64 (matches XMDS submitScreenShot format)
      const jpegBuffer = image.toJPEG(80);
      return jpegBuffer.toString('base64');
    } catch (error) {
      console.error('[Screenshot] Capture failed:', error.message);
      return null;
    }
  });

  // Get app version
  ipcMain.handle('get-version', () => {
    return APP_VERSION;
  });

  // Execute shell command (CMS widget/display commands)
  // commandString arrives in CMS format: "shell|actual_command" or bare "actual_command"
  ipcMain.handle('execute-shell-command', async (_event, { commandString }) => {
    if (!config.allowShellCommands) {
      console.warn('[Shell] Shell commands disabled (set allowShellCommands: true)');
      return { success: false, reason: 'Shell commands disabled' };
    }
    if (!commandString) return { success: false, reason: 'Empty command' };

    // Strip CMS type prefix (e.g., "shell|reboot" → "reboot")
    const cmd = commandString.includes('|') ? commandString.split('|').slice(1).join('|') : commandString;
    if (!cmd) return { success: false, reason: 'Empty command after prefix strip' };

    console.log('[Shell] Executing:', cmd);
    try {
      const { stdout, stderr } = await execPromise(cmd, { timeout: 30000 });
      console.log('[Shell] OK:', stdout.trim());
      return { success: true, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (error) {
      console.error('[Shell] Failed:', error.message);
      return { success: false, reason: error.message };
    }
  });

  // Reload the player
  ipcMain.on('reload-player', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });

  // Restart the application
  ipcMain.on('restart-app', () => {
    app.relaunch();
    app.isQuitting = true;
    app.quit();
  });
}

/**
 * Application initialization
 */
app.whenReady().then(async () => {
  console.log(`[App] Starting Xibo Player v${APP_VERSION}`);
  if (instanceName) console.log(`[App] Instance: ${instanceName}`);
  console.log(`[App] User data path: ${app.getPath('userData')}`);
  console.log(`[App] Development mode: ${isDev}`);
  console.log(`[App] Kiosk mode: ${!noKiosk}`);
  console.log(`[App] Electron: ${process.versions.electron}, Chrome: ${process.versions.chrome}`);

  // Create Express server to serve PWA files
  await createExpressServer();

  // Clear stale Service Worker when bundled PWA version changes.
  // A version mismatch means the SW may cache index.html referencing
  // content-hashed assets (main-XXXX.js) that no longer exist in the
  // new build — Express would serve HTML fallback → MIME type error
  // → black screen.  Clearing only on version change preserves offline
  // capability during normal operation.
  await clearStaleServiceWorker();

  // Create main window
  createWindow();

  // Setup system integrations
  preventSystemSleep();
  createSystemTray();
  setupKeyboardShortcuts();
  setupIpcHandlers();

  // Setup auto-launch if enabled
  if (config.autoLaunch) {
    try {
      await autoLauncher.enable();
    } catch (err) {
      console.warn('[AutoLaunch] Failed to enable:', err.message);
    }
  }

  console.log('[App] Xibo Player started successfully');
});

/**
 * macOS specific: Re-create window when dock icon is clicked
 */
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

/**
 * Cleanup on quit
 */
app.on('will-quit', () => {
  // Stop power save blocker
  if (powerSaveBlockerId !== null) {
    powerSaveBlocker.stop(powerSaveBlockerId);
  }

  // Close Express server
  if (expressServer) {
    expressServer.close();
  }
});

/**
 * Handle window close
 */
app.on('window-all-closed', () => {
  // On macOS, keep app running in dock
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

/**
 * Handle SIGTERM/SIGINT for clean systemd shutdown
 */
process.on('SIGTERM', () => {
  console.log('[App] Received SIGTERM, shutting down');
  if (expressServer) expressServer.close();
  app.quit();
});

process.on('SIGINT', () => {
  console.log('[App] Received SIGINT, shutting down');
  if (expressServer) expressServer.close();
  app.quit();
});

/**
 * Handle unhandled errors gracefully
 */
process.on('uncaughtException', (error) => {
  console.error('[App] Uncaught exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[App] Unhandled rejection at:', promise, 'reason:', reason);
});
