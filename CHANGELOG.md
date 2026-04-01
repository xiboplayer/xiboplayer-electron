# Changelog

## Unreleased

### Bug Fixes

- **APP_VERSION from package.json** — No longer 3 independent hardcoded version constants. `main.js` and `server-standalone.js` both read from `package.json` at runtime.
- **Debug logging reverted** — `if (true)` reverted to `(isDev || level >= 2)`. Production logs no longer flooded with renderer debug output.
- **Stale dev path fixed** — `server-standalone.js` referenced the old `xiboplayer-pwa` repo; updated to SDK monorepo `packages/pwa`.
- **CI default-version synced** — Matched to 0.7.11.
- **Vitest excludes e2e** — Added `vitest.config.js` to prevent Playwright specs from running under vitest.

### Testing

- **20 unit tests** (Vitest) — `parseArgument`, IPC config allowlist, CORS headers, memory tuning tiers.
- **7 e2e tests** (Playwright) — App launch, window creation, IPC get-version, get-system-info, set-config allowlist, PWA page load, tray.
- First test suite for this repo.

### Infrastructure

- **Dependabot** added for npm + GitHub Actions.

## 0.7.11 (2026-03-31)

- chore: bump version to 0.7.11
- feat: optional XIBOPLAYER_DEBUG_PORT for CDP monitoring (FPS, memory)
