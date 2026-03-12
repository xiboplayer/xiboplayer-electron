#!/usr/bin/env node

// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Xibo Player - Standalone Express Server
 *
 * Serves the PWA player without Electron. Use with Chromium kiosk mode
 * for systems where Electron's GPU acceleration doesn't work.
 *
 * Usage:
 *   node server-standalone.js [--port=8765] [--dev]
 *   # Then open Chromium: chromium-browser --kiosk --app=http://localhost:8765/player/pwa/
 */

const path = require('path');

const APP_VERSION = '0.9.0';

// Parse CLI args
const args = process.argv.slice(2);
const isDev = args.includes('--dev');
const portArg = args.find(a => a.startsWith('--port='));
const serverPort = portArg ? parseInt(portArg.split('=')[1], 10) : 8765;

// PWA dist path
const pwaPath = isDev
  ? path.join(__dirname, '../../xiboplayer-pwa/dist')
  : path.join(__dirname, '../node_modules/@xiboplayer/pwa/dist');

console.log(`[Server] PWA path: ${pwaPath}`);
console.log(`[Server] Port: ${serverPort}, Dev: ${isDev}`);

import('@xiboplayer/proxy').then(({ startServer }) => {
  return startServer({ port: serverPort, pwaPath, appVersion: APP_VERSION });
}).catch((err) => {
  console.error('[Server] Failed to start:', err.message);
  process.exit(1);
});
