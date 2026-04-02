# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: electron.spec.js >> Electron app launch >> app starts and creates a window
- Location: tests/e2e/electron.spec.js:39:3

# Error details

```
Error: expect(received).toBeGreaterThan(expected)

Expected: > 0
Received:   0
```

# Test source

```ts
  1   | // SPDX-License-Identifier: AGPL-3.0-or-later
  2   | // Copyright (c) 2024-2026 Pau Aliagas <linuxnow@gmail.com>
  3   | /**
  4   |  * Electron e2e tests with Playwright.
  5   |  *
  6   |  * Requires: a display (real or virtual via Xvfb), @xiboplayer/proxy + @xiboplayer/pwa installed.
  7   |  * Run: npx playwright test tests/e2e/
  8   |  * With virtual display: xvfb-run npx playwright test tests/e2e/
  9   |  */
  10  | 
  11  | const { test, expect, _electron: electron } = require('@playwright/test');
  12  | const path = require('path');
  13  | const fs = require('fs');
  14  | 
  15  | const MAIN_JS = path.join(__dirname, '../../src/main.js');
  16  | 
  17  | // Temporary config dir and port for test isolation (avoid conflicts with running players)
  18  | const TEST_CONFIG_DIR = path.join('/tmp', `xiboplayer-electron-test-${process.pid}`);
  19  | const TEST_PORT = 8770 + (process.pid % 100); // Unique port per test run, avoids 8765/8766
  20  | 
  21  | test.beforeAll(() => {
  22  |   fs.mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  23  | });
  24  | 
  25  | test.afterAll(() => {
  26  |   fs.rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  27  | });
  28  | 
  29  | test.describe('Electron app launch', () => {
  30  |   let electronApp;
  31  | 
  32  |   test.afterEach(async () => {
  33  |     if (electronApp) {
  34  |       await electronApp.close();
  35  |       electronApp = null;
  36  |     }
  37  |   });
  38  | 
  39  |   test('app starts and creates a window', async () => {
  40  |     electronApp = await electron.launch({
  41  |       args: [MAIN_JS, '--no-kiosk', `--instance=test-${process.pid}`, `--port=${TEST_PORT}`],
  42  |       env: {
  43  |         ...process.env,
  44  |         XDG_CONFIG_HOME: TEST_CONFIG_DIR,
  45  |         DISPLAY: process.env.DISPLAY || ':99',
  46  |       },
  47  |     });
  48  | 
  49  |     const window = await electronApp.firstWindow();
  50  |     expect(window).toBeTruthy();
  51  | 
  52  |     const title = await window.title();
  53  |     // Title should contain "Xibo" or be the PWA page title
> 54  |     expect(title.length).toBeGreaterThan(0);
      |                          ^ Error: expect(received).toBeGreaterThan(expected)
  55  |   });
  56  | 
  57  |   test('window has correct default dimensions', async () => {
  58  |     electronApp = await electron.launch({
  59  |       args: [MAIN_JS, '--no-kiosk', `--instance=test-${process.pid}`, `--port=${TEST_PORT}`],
  60  |       env: {
  61  |         ...process.env,
  62  |         XDG_CONFIG_HOME: TEST_CONFIG_DIR,
  63  |         DISPLAY: process.env.DISPLAY || ':99',
  64  |       },
  65  |     });
  66  | 
  67  |     const window = await electronApp.firstWindow();
  68  |     const size = await window.evaluate(() => ({
  69  |       width: window.innerWidth,
  70  |       height: window.innerHeight,
  71  |     }));
  72  | 
  73  |     // Default is 1920x1080 or whatever the display supports
  74  |     expect(size.width).toBeGreaterThan(0);
  75  |     expect(size.height).toBeGreaterThan(0);
  76  |   });
  77  | 
  78  |   test('IPC get-version returns package.json version', async () => {
  79  |     electronApp = await electron.launch({
  80  |       args: [MAIN_JS, '--no-kiosk', `--instance=test-${process.pid}`, `--port=${TEST_PORT}`],
  81  |       env: {
  82  |         ...process.env,
  83  |         XDG_CONFIG_HOME: TEST_CONFIG_DIR,
  84  |         DISPLAY: process.env.DISPLAY || ':99',
  85  |       },
  86  |     });
  87  | 
  88  |     const window = await electronApp.firstWindow();
  89  | 
  90  |     // Wait for preload to be ready
  91  |     await window.waitForFunction(() => window.electronAPI !== undefined, { timeout: 10000 });
  92  | 
  93  |     const version = await window.evaluate(async () => {
  94  |       return await window.electronAPI.getVersion();
  95  |     });
  96  | 
  97  |     const expectedVersion = require('../../package.json').version;
  98  |     expect(version).toBe(expectedVersion);
  99  |   });
  100 | 
  101 |   test('IPC get-system-info returns hardware data', async () => {
  102 |     electronApp = await electron.launch({
  103 |       args: [MAIN_JS, '--no-kiosk', `--instance=test-${process.pid}`, `--port=${TEST_PORT}`],
  104 |       env: {
  105 |         ...process.env,
  106 |         XDG_CONFIG_HOME: TEST_CONFIG_DIR,
  107 |         DISPLAY: process.env.DISPLAY || ':99',
  108 |       },
  109 |     });
  110 | 
  111 |     const window = await electronApp.firstWindow();
  112 |     await window.waitForFunction(() => window.electronAPI !== undefined, { timeout: 10000 });
  113 | 
  114 |     const info = await window.evaluate(async () => {
  115 |       return await window.electronAPI.getSystemInfo();
  116 |     });
  117 | 
  118 |     expect(info).toHaveProperty('platform');
  119 |     expect(info).toHaveProperty('arch');
  120 |     expect(info).toHaveProperty('totalMemory');
  121 |     expect(info.totalMemory).toBeGreaterThan(0);
  122 |   });
  123 | 
  124 |   test('IPC set-config respects allowlist', async () => {
  125 |     electronApp = await electron.launch({
  126 |       args: [MAIN_JS, '--no-kiosk', `--instance=test-${process.pid}`, `--port=${TEST_PORT}`],
  127 |       env: {
  128 |         ...process.env,
  129 |         XDG_CONFIG_HOME: TEST_CONFIG_DIR,
  130 |         DISPLAY: process.env.DISPLAY || ':99',
  131 |       },
  132 |     });
  133 | 
  134 |     const window = await electronApp.firstWindow();
  135 |     await window.waitForFunction(() => window.electronAPI !== undefined, { timeout: 10000 });
  136 | 
  137 |     // Allowed key should work
  138 |     const result = await window.evaluate(async () => {
  139 |       return await window.electronAPI.setConfig({ cmsUrl: 'https://test.example.com' });
  140 |     });
  141 |     expect(result).toBeTruthy();
  142 |   });
  143 | 
  144 |   test('PWA setup page loads', async () => {
  145 |     electronApp = await electron.launch({
  146 |       args: [MAIN_JS, '--no-kiosk', `--instance=test-${process.pid}`, `--port=${TEST_PORT}`],
  147 |       env: {
  148 |         ...process.env,
  149 |         XDG_CONFIG_HOME: TEST_CONFIG_DIR,
  150 |         DISPLAY: process.env.DISPLAY || ':99',
  151 |       },
  152 |     });
  153 | 
  154 |     const window = await electronApp.firstWindow();
```