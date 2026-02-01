/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { BrowserTool } from './browser-tool.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import puppeteer from 'puppeteer-core';
import * as chromeLauncher from 'chrome-launcher';
import type { Config } from '../config/config.js';
import { isPortOpen } from '../utils/port-utils.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

vi.mock('puppeteer-core');
vi.mock('chrome-launcher');
vi.mock('../utils/port-utils.js');
vi.mock('node:child_process');
vi.mock('node:fs');

describe('BrowserTool Auto-Startup', () => {
  let tool: BrowserTool;
  let messageBus: MessageBus;
  let config: Config;
  let mockBrowser: unknown;
  let mockPage: {
    goto: Mock;
    screenshot: Mock;
    setViewport: Mock;
    isClosed: Mock;
  };
  let mockChrome: { port: number; kill: Mock };
  let mockChildProcess: { unref: Mock };

  beforeEach(() => {
    vi.resetAllMocks();

    config = {
      getTargetDir: vi.fn().mockReturnValue('/mock/dir'),
    } as unknown as Config;

    messageBus = {
      publish: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    } as unknown as MessageBus;

    mockPage = {
      goto: vi.fn(),
      screenshot: vi.fn().mockResolvedValue('base64screenshot'),
      setViewport: vi.fn(),
      isClosed: vi.fn().mockReturnValue(false),
    };

    mockBrowser = {
      pages: vi.fn().mockResolvedValue([mockPage]),
      isConnected: vi.fn().mockReturnValue(true),
      close: vi.fn(),
    };

    mockChrome = {
      port: 1234,
      kill: vi.fn(),
    };

    mockChildProcess = {
      unref: vi.fn(),
    };

    vi.mocked(puppeteer.connect).mockResolvedValue(
      mockBrowser as puppeteer.Browser,
    );
    vi.mocked(chromeLauncher.launch).mockResolvedValue(
      mockChrome as unknown as chromeLauncher.LaunchedChrome,
    );
    vi.mocked(spawn).mockReturnValue(
      mockChildProcess as unknown as import('node:child_process').ChildProcess,
    );

    tool = new BrowserTool(config, messageBus);
  });

  it('should attempt auto-startup if localhost port is closed and package.json has scripts', async () => {
    vi.mocked(isPortOpen)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        scripts: { dev: 'npm run dev' },
      }),
    );

    await tool.buildAndExecute(
      { action: 'open_url', url: 'http://localhost:3000' },
      new AbortController().signal,
    );

    expect(isPortOpen).toHaveBeenCalledWith(3000, 'localhost');
    expect(spawn).toHaveBeenCalledWith(
      'npm',
      ['run', 'dev'],
      expect.any(Object),
    );
    expect(mockPage.goto).toHaveBeenCalledWith(
      'http://localhost:3000',
      expect.any(Object),
    );
  });

  it('should not attempt auto-startup if port is already open', async () => {
    vi.mocked(isPortOpen).mockResolvedValue(true);

    await tool.buildAndExecute(
      { action: 'open_url', url: 'http://localhost:3000' },
      new AbortController().signal,
    );

    expect(isPortOpen).toHaveBeenCalledWith(3000, 'localhost');
    expect(spawn).not.toHaveBeenCalled();
    expect(mockPage.goto).toHaveBeenCalledWith(
      'http://localhost:3000',
      expect.any(Object),
    );
  });
});
