/**
 * Preload script - Security bridge between main and renderer process
 *
 * This script runs in a privileged context and exposes a minimal API
 * to the renderer process through the contextBridge.
 *
 * The PWA player code can check `window.electronAPI` to detect it's
 * running inside Electron and use Electron-specific features:
 * - Native screenshot capture (webContents.capturePage)
 * - System information for hardware key generation
 * - Configuration persistence via electron-store
 * - App lifecycle control (reload, restart)
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // ── Platform Detection ──
  isElectron: true,
  platform: process.platform,

  // ── Configuration ──
  getConfig: () => ipcRenderer.invoke('get-config'),
  setConfig: (config) => ipcRenderer.invoke('set-config', config),

  // ── System Information ──
  // Used by PWA for hardware key generation with Electron-specific system info
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),

  // ── Screenshot Capture ──
  // Native Electron screenshot via webContents.capturePage()
  // Returns base64 JPEG string or null on failure
  // Much better than html2canvas: captures video frames, WebGL, composited layers
  captureScreenshot: () => ipcRenderer.invoke('capture-screenshot'),

  // ── Version ──
  getVersion: () => ipcRenderer.invoke('get-version'),

  // ── Shell Commands ──
  // Execute native shell commands from CMS (requires allowShellCommands: true)
  executeShellCommand: (data) => ipcRenderer.invoke('execute-shell-command', data),

  // ── Cursor Management ──
  resetCursorTimeout: () => ipcRenderer.send('reset-cursor-timeout'),

  // ── App Lifecycle ──
  reloadPlayer: () => ipcRenderer.send('reload-player'),
  restartApp: () => ipcRenderer.send('restart-app'),
});

// Forward certificate warnings from main process → renderer
ipcRenderer.on('cert-warning', (_event, { url, host, error }) => {
  console.warn(`[Security] Invalid certificate accepted for: ${host} (${error})`);
  // Dispatch custom event so overlays can pick it up
  window.dispatchEvent(new CustomEvent('cert-warning', { detail: { url, host, error } }));
});

// Forward proxy logs from main process → renderer DevTools console
ipcRenderer.on('proxy-log', (_event, { level, name, args }) => {
  const d = new Date();
  const ts = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  const prefix = `${ts} [${name}]`;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(prefix, ...args);
});

// Log that preload script loaded
console.log('[Preload] Preload script initialized (Electron shell)');
