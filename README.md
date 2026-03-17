# Xibo Player - Electron Kiosk Wrapper

Production-ready Electron kiosk application that wraps the Xibo PWA player for easy deployment on desktop systems.

## Features

### Kiosk Mode
- **Fullscreen display** - No window chrome or decorations
- **Keyboard shortcut protection** - Disables system shortcuts
- **Mouse cursor hiding** - Auto-hides after 5 seconds of inactivity
- **Navigation protection** - Prevents navigation away from player
- **Always on top** - Cannot be minimized or covered

### System Integration
- **Auto-start on boot** - systemd user service support
- **Prevent system sleep** - Display stays on during playback
- **System tray control** - Hidden menu accessible via Ctrl+Shift+F12
- **Service management** - Easy enable/disable via systemd

### Multi-Display Sync (v0.7.0)
- **Video wall support** - Synchronized layout transitions across multiple displays with <8ms precision
- **Lead/follower architecture** - CMS assigns roles via sync groups
- **12 choreography effects** - Diagonal cascade, wave sweep, center-out, and more
- **WebSocket relay** - Token-authenticated LAN sync on the lead's HTTP port
- **Offline LAN sync** - Persisted config enables sync without CMS connectivity
- **Multi-instance support** - Run multiple displays on the same machine (`--instance=NAME`)

### CMS Communication
- **REST API first** - Uses the Xibo CMS REST API as the primary protocol
- **XMDS SOAP fallback** - Falls back to XMDS SOAP when REST is unavailable

### Local HTTP Server
- **Serves PWA files** - Built-in Express server on localhost:8765
- **CORS handling** - Strips and re-injects CORS headers to avoid double-header issues with reverse proxies
- **Zero configuration** - Works out of the box

### Logging
- **Configurable log levels** - `error`, `warn`, `info`, `debug`, `trace`
- **Ideal for deployments** - Use `debug` during initial setup to verify CMS connectivity, schedule parsing, and media downloads, then switch to `warn` or `error` for production

### Configuration
- **Persistent storage** - electron-store for configuration
- **Command-line arguments** - Override settings at startup
- **JSON config file** - Easy manual editing if needed
- **Config UI** - Access via system tray menu

## Installation

### From RPM (Fedora/RHEL)

```bash
sudo dnf install xiboplayer-electron-*.rpm
```

## Configuration

### Config file — `config.json` (recommended for provisioning)

Place a config file at `~/.config/xiboplayer/electron/config.json` before first launch:

```json
{
  "cmsUrl": "https://your-cms.example.com",
  "cmsKey": "your-cms-key",
  "displayName": "Lobby Display"
}
```

On first boot, if the player has no existing CMS configuration, it reads this
file and seeds the internal store. The player then registers with the CMS and
shows a setup screen while it waits for administrator authorization. Once
authorized, it starts playing the scheduled content.

The file is only read when the store has no `cmsUrl` yet — after first boot
it is effectively ignored. CLI args always take priority.

### Setup screen (interactive)

If no `config.json` is present and no CLI args are provided, the player shows
a setup screen where you enter the CMS URL, key, and display name in the
browser. If registration fails (wrong URL, CMS unreachable), the player
redirects back to the setup screen automatically.

### Auto-authorize via CMS API (optional)

By default, new displays must be manually authorized by a CMS administrator. To skip this step, add OAuth2 API credentials to `config.json` — see the [PWA README](https://github.com/xibo-players/xiboplayer-pwa#auto-authorize-via-cms-api-optional) for full setup instructions including CMS Application configuration:

```json
{
  "cmsUrl": "https://your-cms.example.com",
  "cmsKey": "your-cms-key",
  "displayName": "Lobby Display",
  "apiClientId": "your-client-id",
  "apiClientSecret": "your-client-secret"
}
```

You can also enter the API credentials interactively in the setup page under "Auto-authorize via API".

### Command-line arguments

```bash
xiboplayer-electron --dev              # Development mode (enables DevTools)
xiboplayer-electron --no-kiosk         # Disable kiosk mode
xiboplayer-electron --port=8080        # Custom Express server port
xiboplayer-electron --instance=NAME    # Run as named instance (isolated config/data)
xiboplayer-electron --cms-url=URL      # CMS URL
xiboplayer-electron --cms-key=KEY      # CMS key
xiboplayer-electron --display-name=NAME  # Display name
```

CLI args are persisted to the internal store and survive restarts.

### Config priority

1. **CLI args** — always win, written to store unconditionally
2. **config.json** — read only on first boot (store empty)
3. **Setup screen** — interactive fallback when nothing else is configured

### Paths

| Purpose | Path |
|---------|------|
| Config (electron-store, preferences) | `~/.config/xiboplayer/electron/` |
| Session data (Cache, IndexedDB, SW) | `~/.local/share/xiboplayer/electron/` |
| CMS config file for provisioning | `~/.config/xiboplayer/electron/config.json` |

### Log Levels

Default log level is **WARNING** (production-safe). The `--dev` flag automatically
sets DEBUG logging. Override via URL parameter `?logLevel=DEBUG`, localStorage, or
CMS display settings. Log levels only affect logging verbosity — debug overlays
are controlled separately via `controls.keyboard.debugOverlays` in `config.json`.

| Level | Use case |
|-------|----------|
| `DEBUG` | Initial deployment — verify CMS connectivity, schedule parsing, media downloads (auto-set by `--dev`) |
| `INFO` | Normal operation |
| `WARNING` | Production default — only unexpected conditions |
| `ERROR` | Production — only failures |
| `NONE` | Silent |

## Usage

### Starting the Player

```bash
# Run from command line
xiboplayer-electron

# Or launch from applications menu
# Applications → AudioVideo → Xibo Player
```

### Auto-Start on Boot

**Enable:**
```bash
systemctl --user enable xiboplayer-electron.service
systemctl --user start xiboplayer-electron.service
```

**Disable:**
```bash
systemctl --user stop xiboplayer-electron.service
systemctl --user disable xiboplayer-electron.service
```

**Check status:**
```bash
systemctl --user status xiboplayer-electron.service
```

**View logs:**
```bash
journalctl --user -u xiboplayer-electron.service -f
```

### Keyboard Shortcuts

**Electron shortcuts:**
- **Ctrl+Shift+F12** - Show system tray menu
- **Ctrl+Shift+R** - Reload player
- **Ctrl+Shift+I** - Toggle DevTools (dev mode only)

**PWA player shortcuts** (must be enabled in `config.json` `controls` section — all disabled by default):

| Key | Group | Action |
|-----|-------|--------|
| `D` | `debugOverlays` | Toggle download progress overlay |
| `T` | `debugOverlays` | Toggle timeline overlay (click-to-skip supported) |
| `S` | `setupKey` | Toggle CMS setup screen |
| `V` | `videoControls` | Toggle native `<video>` controls |
| `→` / `PageDown` | `playbackControl` | Skip to next layout |
| `←` / `PageUp` | `playbackControl` | Skip to previous layout |
| `Space` | `playbackControl` | Pause / resume playback |
| `R` | `playbackControl` | Revert to scheduled layout |
| Media keys | `playbackControl` | Next/prev/pause/play (MediaSession API) |

See [CONFIG.md](CONFIG.md) for enabling specific control groups.

### System Tray Menu

Right-click the system tray icon (or press Ctrl+Shift+F12) to access:

- Show Player
- Restart Player
- Configuration
- Auto-start on Boot
- Exit Player

## Multiple Displays

Run multiple independent player instances on the same machine using `--instance=NAME`. Each instance gets its own config, session data, and server port:

```bash
# Instance "lobby" — default port 8765
xiboplayer-electron --instance=lobby

# Instance "cafeteria" — port 8766
xiboplayer-electron --instance=cafeteria --port=8766
```

Each instance uses isolated paths:

| | Default (no instance) | `--instance=lobby` |
|---|---|---|
| **Config** | `~/.config/xiboplayer/electron/` | `~/.config/xiboplayer/electron-lobby/` |
| **Session data** | `~/.local/share/xiboplayer/electron/` | `~/.local/share/xiboplayer/electron-lobby/` |

### Setup

1. Create a config for each instance:
```bash
mkdir -p ~/.config/xiboplayer/electron-lobby
cat > ~/.config/xiboplayer/electron-lobby/config.json << 'EOF'
{
  "cmsUrl": "https://cms.example.com",
  "cmsKey": "your-key",
  "displayName": "Lobby Display",
  "serverPort": 8765
}
EOF
```

2. Create a systemd service per instance:
```bash
cp ~/.config/systemd/user/xiboplayer-electron.service \
   ~/.config/systemd/user/xiboplayer-lobby.service
# Edit: ExecStart=/usr/bin/xiboplayer-electron --instance=lobby
systemctl --user enable --now xiboplayer-lobby.service
```

Each instance registers as a separate display in the CMS.

## Building from Source

```bash
npm install
npm run make
```

This builds the RPM via electron-forge into `out/make/rpm/x86_64/`.
For production builds, use the external RPM spec instead.

## Development

### Run in Development Mode

```bash
npx electron . --dev --no-kiosk
```

This enables:
- DEBUG log level (via `?logLevel=DEBUG` URL param)
- DevTools access (Ctrl+Shift+I)
- Console logging
- Error reporting

### Debug Output

Set environment variable for verbose logging:

```bash
DEBUG=* xiboplayer-electron
```

## Architecture

### Main Process (src/main.js)

The main process handles:
- Window management and kiosk mode
- Express server for serving PWA files
- System integrations (auto-launch, power management)
- Configuration storage
- IPC communication with renderer

### Renderer Process

The renderer is the PWA player loaded from `http://localhost:8765`:
- Uses the PWA built from `@xiboplayer/*` packages (installed via npm)
- Full access to PWA features (cache, offline, etc.)
- Communicates with main via IPC when needed

### Preload Script (src/preload.js)

Security bridge between main and renderer:
- Exposes minimal API via contextBridge
- Prevents direct Node.js access
- Maintains security best practices

### Express Server

Built-in HTTP server:
- Serves PWA files from `resources/pwa/`
- Runs on localhost:8765 (configurable)
- SPA routing support

## Security

### Sandboxing

The renderer process runs in a sandbox with:
- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`

### Content Security Policy

The PWA sets appropriate CSP headers to prevent XSS attacks.

### GPU Hardware Acceleration

The player enables GPU-accelerated video decode and compositing via command-line flags
(`ignore-gpu-blocklist`, `enable-gpu-rasterization`, `VaapiVideoDecoder`, etc.).

For hardware video decode, install the appropriate VAAPI driver for your GPU:

| GPU | Package (Fedora) | Notes |
|-----|-------------------|-------|
| Intel | `libva-intel-media-driver` | Works out of the box on most distros |
| AMD | `mesa-va-drivers` | Included with Mesa |
| NVIDIA | `libva-nvidia-driver` | RPM Fusion; bridges VAAPI → NVDEC |

Verify with `vainfo`:
```bash
sudo dnf install libva-utils
vainfo
```

### Permissions

The app requests minimal permissions:
- Display management (fullscreen, prevent sleep)
- Network access (HTTP server, XMDS communication)
- File system access (config and cache storage)

## Reconfiguring the Player

To change CMS connection parameters (address, key, display name) on a running player, open the setup page from any browser on the same machine:

```
http://localhost:8765/player/setup.html
```

This works even when the player is in kiosk mode. To force a full re-registration (new display):

```bash
# Wipe all config and restart — shows setup screen
rm -rf ~/.config/xiboplayer/electron
systemctl --user restart xiboplayer-electron.service
```

## Troubleshooting

### Player won't start

```bash
# Check if port is available
ss -tlnp | grep 8765

# Try different port
xiboplayer-electron --port=8080

# Check logs
journalctl --user -u xiboplayer-electron.service -n 50
```

### Black screen

```bash
# Check PWA files exist
ls -la ~/.local/share/xiboplayer/electron/pwa/

# Reinstall package
sudo dnf reinstall xiboplayer-electron-*.rpm
```

### CORS errors

Electron strips existing CORS headers from CMS responses and injects its own `Access-Control-Allow-Origin: *`, so double-header issues with reverse proxies (e.g. SWAG/nginx) are handled automatically. If you still see CORS errors, check that the CMS is reachable from the player.

### Service won't auto-start

```bash
# Enable lingering (user service without login)
loginctl enable-linger $USER

# Check service status
systemctl --user status xiboplayer-electron.service

# View full logs
journalctl --user -u xiboplayer-electron.service --no-pager
```

### Can't exit kiosk mode

Press **Ctrl+Shift+F12** to show system tray menu, then select "Exit Player".

Or from terminal:
```bash
pkill -f xiboplayer-electron
```

## Uninstallation

### RPM
```bash
sudo dnf remove xiboplayer-electron
```

### Remove Configuration

Configuration files are preserved during uninstallation. To remove manually:

```bash
rm -rf ~/.config/xiboplayer/electron
rm -rf ~/.config/systemd/user/xiboplayer-electron.service
rm -rf ~/.local/share/applications/xiboplayer-electron.desktop
```

## Support

- **GitHub Issues:** https://github.com/xibo-players/xiboplayer-electron/issues

## Credits

- **Xibo CMS:** https://xibosignage.com
- **Electron:** https://www.electronjs.org/

## License

AGPL-3.0-or-later
