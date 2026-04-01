// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2024-2026 Pau Aliagas <linuxnow@gmail.com>
/**
 * Unit tests for Electron main process pure-logic functions.
 *
 * Tests functions extracted from src/main.js without needing
 * Electron's app or BrowserWindow modules.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── parseArgument ──────────────────────────────────────────

function parseArgument(key, type = 'string', defaultValue = null, argv = process.argv) {
  const arg = argv.find(a => a.startsWith(`--${key}=`));
  if (!arg) return defaultValue;
  const value = arg.split('=').slice(1).join('=');
  return type === 'int' ? parseInt(value, 10) : value;
}

describe('parseArgument', () => {
  const argv = ['node', 'main.js', '--port=8765', '--name=test', '--count=3', '--url=https://a.com/b=c'];

  it('extracts string value', () => {
    expect(parseArgument('name', 'string', null, argv)).toBe('test');
  });

  it('extracts int value', () => {
    expect(parseArgument('count', 'int', null, argv)).toBe(3);
  });

  it('returns default when key not found', () => {
    expect(parseArgument('missing', 'string', 'fallback', argv)).toBe('fallback');
  });

  it('returns null default by default', () => {
    expect(parseArgument('missing', 'string', null, argv)).toBeNull();
  });

  it('handles values containing =', () => {
    expect(parseArgument('url', 'string', null, argv)).toBe('https://a.com/b=c');
  });

  it('handles port as string', () => {
    expect(parseArgument('port', 'string', null, argv)).toBe('8765');
  });

  it('handles port as int', () => {
    expect(parseArgument('port', 'int', null, argv)).toBe(8765);
  });
});

// ── IPC config allowlist ────────────────────────────────────

const CONFIG_ALLOWLIST = ['cmsUrl', 'cmsKey', 'displayName', 'serverPort', 'sync', 'apiClientId', 'apiClientSecret'];

describe('IPC config allowlist', () => {
  it('allows cmsUrl', () => {
    expect(CONFIG_ALLOWLIST.includes('cmsUrl')).toBe(true);
  });

  it('blocks arbitrary keys', () => {
    expect(CONFIG_ALLOWLIST.includes('__proto__')).toBe(false);
    expect(CONFIG_ALLOWLIST.includes('hardwareKey')).toBe(false);
    expect(CONFIG_ALLOWLIST.includes('constructor')).toBe(false);
  });

  it('has exactly 7 allowed keys', () => {
    expect(CONFIG_ALLOWLIST).toHaveLength(7);
  });
});

// ── CORS headers ───────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ['*'],
  'Access-Control-Allow-Methods': ['GET, POST, PUT, DELETE, OPTIONS'],
  'Access-Control-Allow-Headers': ['Content-Type, SOAPAction, Authorization, Accept'],
  'Access-Control-Max-Age': ['86400'],
};

describe('CORS headers', () => {
  it('allows all origins', () => {
    expect(CORS_HEADERS['Access-Control-Allow-Origin']).toEqual(['*']);
  });

  it('includes SOAPAction for XMDS', () => {
    expect(CORS_HEADERS['Access-Control-Allow-Headers'][0]).toContain('SOAPAction');
  });

  it('includes Authorization for REST API', () => {
    expect(CORS_HEADERS['Access-Control-Allow-Headers'][0]).toContain('Authorization');
  });

  it('caches preflight for 24 hours', () => {
    expect(CORS_HEADERS['Access-Control-Max-Age']).toEqual(['86400']);
  });
});

// ── Memory tuning tiers ────────────────────────────────────

function getMemoryTuning(totalRAM_GB, cpuCount) {
  let maxOldSpaceMB, rasterThreads;
  if (totalRAM_GB <= 1) {
    maxOldSpaceMB = 128; rasterThreads = 1;
  } else if (totalRAM_GB <= 2) {
    maxOldSpaceMB = 192; rasterThreads = 2;
  } else if (totalRAM_GB <= 4) {
    maxOldSpaceMB = 256; rasterThreads = Math.min(cpuCount, 2);
  } else if (totalRAM_GB <= 8) {
    maxOldSpaceMB = 512; rasterThreads = Math.min(cpuCount, 4);
  } else {
    maxOldSpaceMB = 768; rasterThreads = Math.min(cpuCount, 4);
  }
  return { maxOldSpaceMB, rasterThreads };
}

describe('memory tuning', () => {
  it('1GB: 128MB heap, 1 raster thread', () => {
    expect(getMemoryTuning(1, 4)).toEqual({ maxOldSpaceMB: 128, rasterThreads: 1 });
  });

  it('2GB: 192MB heap, 2 raster threads', () => {
    expect(getMemoryTuning(2, 4)).toEqual({ maxOldSpaceMB: 192, rasterThreads: 2 });
  });

  it('4GB: 256MB heap, capped raster threads', () => {
    expect(getMemoryTuning(4, 8)).toEqual({ maxOldSpaceMB: 256, rasterThreads: 2 });
  });

  it('8GB: 512MB heap, up to 4 raster threads', () => {
    expect(getMemoryTuning(8, 2)).toEqual({ maxOldSpaceMB: 512, rasterThreads: 2 });
  });

  it('16GB: 768MB heap, 4 raster threads', () => {
    expect(getMemoryTuning(16, 8)).toEqual({ maxOldSpaceMB: 768, rasterThreads: 4 });
  });

  it('Raspberry Pi: 512MB RAM', () => {
    const result = getMemoryTuning(0.5, 4);
    expect(result.maxOldSpaceMB).toBe(128);
    expect(result.rasterThreads).toBe(1);
  });
});
