/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BrowserTool } from './browser-tool.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import puppeteer from 'puppeteer-core';
import * as chromeLauncher from 'chrome-launcher';

vi.mock('puppeteer-core');
vi.mock('chrome-launcher');

describe('BrowserTool', () => {
  let tool: BrowserTool;
  let messageBus: MessageBus;
  let mockBrowser: unknown;
  let mockPage: unknown;
  let mockChrome: unknown;

  beforeEach(() => {
    vi.resetAllMocks();
    messageBus = {
      publish: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    } as unknown as MessageBus;

    mockPage = {
      goto: vi.fn(),
      mouse: {
        click: vi.fn(),
        wheel: vi.fn(),
      },
      keyboard: {
        type: vi.fn(),
      },
      content: vi.fn().mockResolvedValue('<html></html>'),
      screenshot: vi.fn().mockResolvedValue('base64screenshot'),
      setViewport: vi.fn(),
      isClosed: vi.fn().mockReturnValue(false),
    };

    mockBrowser = {
      pages: vi.fn().mockResolvedValue([mockPage]),
      newPage: vi.fn().mockResolvedValue(mockPage),
      isConnected: vi.fn().mockReturnValue(true),
      close: vi.fn(),
    };

    mockChrome = {
      port: 1234,
      kill: vi.fn(),
    };

    vi.mocked(puppeteer.connect).mockResolvedValue(
      mockBrowser as puppeteer.Browser,
    );
    vi.mocked(chromeLauncher.launch).mockResolvedValue(
      mockChrome as chromeLauncher.LaunchedChrome,
    );

    tool = new BrowserTool(messageBus);
  });

  it('should launch browser and open url', async () => {
    const result = await tool.buildAndExecute(
      { action: 'open_url', url: 'https://example.com' },
      new AbortController().signal,
    );

    expect(chromeLauncher.launch).toHaveBeenCalled();
    expect(puppeteer.connect).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mockPage as any).goto).toHaveBeenCalledWith('https://example.com', {
      waitUntil: 'networkidle2',
    });
    expect(result.llmContent).toEqual({
      inlineData: {
        mimeType: 'image/jpeg',
        data: 'base64screenshot',
      },
    });
  });

  it('should click at coordinates', async () => {
    await tool.buildAndExecute(
      { action: 'open_url', url: 'https://example.com' },
      new AbortController().signal,
    );

    await tool.buildAndExecute(
      { action: 'click', x: 100, y: 200 },
      new AbortController().signal,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mockPage as any).mouse.click).toHaveBeenCalledWith(100, 200);
  });

  it('should type text', async () => {
    await tool.buildAndExecute(
      { action: 'type', text: 'hello' },
      new AbortController().signal,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mockPage as any).keyboard.type).toHaveBeenCalledWith('hello');
  });

  it('should scroll', async () => {
    await tool.buildAndExecute(
      { action: 'scroll', delta_x: 0, delta_y: 100 },
      new AbortController().signal,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mockPage as any).mouse.wheel).toHaveBeenCalledWith({
      deltaX: 0,
      deltaY: 100,
    });
  });

  it('should get html', async () => {
    const result = await tool.buildAndExecute(
      { action: 'get_html' },
      new AbortController().signal,
    );
    expect(result.llmContent).toBe('<html></html>');
  });
});
