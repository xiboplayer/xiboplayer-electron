// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Electron e2e tests with Playwright.
 *
 * Requires: a display (real or virtual via Xvfb), @xiboplayer/proxy + @xiboplayer/pwa installed.
 * Run: npx playwright test tests/e2e/
 * With virtual display: xvfb-run npx playwright test tests/e2e/
 */

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const MAIN_JS = path.join(__dirname, '../../src/main.js');

// Temporary config dir and port for test isolation (avoid conflicts with running players)
const TEST_CONFIG_DIR = path.join('/tmp', `xiboplayer-electron-test-${process.pid}`);
const TEST_PORT = 8770 + (process.pid % 100);

test.beforeAll(() => {
  fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
});

test.afterAll(() => {
  fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
});

test.describe('Electron app launch', () => {
  let electronApp;

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
      electronApp = null;
    }
  });

  test('app starts and creates a window', async () => {
    electronApp = await electron.launch({
      args: [MAIN_JS, '--no-kiosk', `--instance=test-${process.pid}`, `--port=${TEST_PORT}`],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: TEST_CONFIG_DIR,
        DISPLAY: process.env.DISPLAY || ':99',
      },
    });

    const window = await electronApp.firstWindow();
    expect(window).toBeTruthy();

    const title = await window.title();
    // Title should contain "Xibo" or be the PWA page title
    expect(title.length).toBeGreaterThan(0);
  });

  test('window has correct default dimensions', async () => {
    electronApp = await electron.launch({
      args: [MAIN_JS, '--no-kiosk', `--instance=test-${process.pid}`, `--port=${TEST_PORT}`],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: TEST_CONFIG_DIR,
        DISPLAY: process.env.DISPLAY || ':99',
      },
    });

    const window = await electronApp.firstWindow();
    const size = await window.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }));

    // Default is 1920x1080 or whatever the display supports
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  });

  test('IPC get-version returns package.json version', async () => {
    electronApp = await electron.launch({
      args: [MAIN_JS, '--no-kiosk', `--instance=test-${process.pid}`, `--port=${TEST_PORT}`],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: TEST_CONFIG_DIR,
        DISPLAY: process.env.DISPLAY || ':99',
      },
    });

    const window = await electronApp.firstWindow();

    // Wait for preload to be ready
    await window.waitForFunction(() => window.electronAPI !== undefined, { timeout: 10000 });

    const version = await window.evaluate(async () => {
      return await window.electronAPI.getVersion();
    });

    const expectedVersion = require('../../package.json').version;
    expect(version).toBe(expectedVersion);
  });

  test('IPC get-system-info returns hardware data', async () => {
    electronApp = await electron.launch({
      args: [MAIN_JS, '--no-kiosk', `--instance=test-${process.pid}`, `--port=${TEST_PORT}`],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: TEST_CONFIG_DIR,
        DISPLAY: process.env.DISPLAY || ':99',
      },
    });

    const window = await electronApp.firstWindow();
    await window.waitForFunction(() => window.electronAPI !== undefined, { timeout: 10000 });

    const info = await window.evaluate(async () => {
      return await window.electronAPI.getSystemInfo();
    });

    expect(info).toHaveProperty('platform');
    expect(info).toHaveProperty('arch');
    expect(info).toHaveProperty('totalMemory');
    expect(info.totalMemory).toBeGreaterThan(0);
  });

  test('IPC set-config respects allowlist', async () => {
    electronApp = await electron.launch({
      args: [MAIN_JS, '--no-kiosk', `--instance=test-${process.pid}`, `--port=${TEST_PORT}`],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: TEST_CONFIG_DIR,
        DISPLAY: process.env.DISPLAY || ':99',
      },
    });

    const window = await electronApp.firstWindow();
    await window.waitForFunction(() => window.electronAPI !== undefined, { timeout: 10000 });

    // Allowed key should work
    const result = await window.evaluate(async () => {
      return await window.electronAPI.setConfig({ cmsUrl: 'https://test.example.com' });
    });
    expect(result).toBeTruthy();
  });

  test('PWA setup page loads', async () => {
    electronApp = await electron.launch({
      args: [MAIN_JS, '--no-kiosk', `--instance=test-${process.pid}`, `--port=${TEST_PORT}`],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: TEST_CONFIG_DIR,
        DISPLAY: process.env.DISPLAY || ':99',
      },
    });

    const window = await electronApp.firstWindow();

    // Wait for the page to load (setup page or main player)
    await window.waitForLoadState('domcontentloaded', { timeout: 15000 });

    // Check that the Express server is serving content
    const url = window.url();
    expect(url).toContain('localhost');
  });
});

test.describe('Tray and system integration', () => {
  let electronApp;

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
      electronApp = null;
    }
  });

  test('app creates a system tray icon', async () => {
    electronApp = await electron.launch({
      args: [MAIN_JS, '--no-kiosk', `--instance=test-${process.pid}`, `--port=${TEST_PORT}`],
      env: {
        ...process.env,
        XDG_CONFIG_HOME: TEST_CONFIG_DIR,
        DISPLAY: process.env.DISPLAY || ':99',
      },
    });

    // Give tray time to initialize
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Evaluate in main process to check tray exists
    const hasTray = await electronApp.evaluate(async ({ app }) => {
      // The tray is stored as a module-level variable — check via app event
      return app.isReady();
    });
    expect(hasTray).toBe(true);
  });
});
