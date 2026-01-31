/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { BaseDeclarativeTool, BaseToolInvocation, Kind } from './tools.js';
import type { ToolResult } from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import puppeteer from 'puppeteer-core';
import * as chromeLauncher from 'chrome-launcher';
import { debugLogger } from '../utils/debugLogger.js';
import { getErrorMessage } from '../utils/errors.js';
import { ToolErrorType } from './tool-error.js';
// import { shouldAttemptBrowserLaunch } from '../utils/browser.js';

interface BrowserToolParams {
  action:
    | 'open_url'
    | 'click'
    | 'type'
    | 'scroll'
    | 'get_screenshot'
    | 'get_html'
    | 'close';
  url?: string;
  x?: number;
  y?: number;
  text?: string;
  delta_x?: number;
  delta_y?: number;
}

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 1024;

class BrowserManager {
  private static instance: BrowserManager;
  private browser: puppeteer.Browser | null = null;
  private page: puppeteer.Page | null = null;
  private chrome: chromeLauncher.LaunchedChrome | null = null;

  private constructor() {}

  static getInstance(): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager();
    }
    return BrowserManager.instance;
  }

  async getPage(): Promise<puppeteer.Page> {
    if (!this.browser || !this.browser.isConnected()) {
      await this.launchBrowser();
    }
    if (!this.page || this.page.isClosed()) {
      const pages = await this.browser!.pages();
      if (pages.length > 0) {
        this.page = pages[0];
      } else {
        this.page = await this.browser!.newPage();
      }
      await this.page.setViewport({
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
      });
    }
    return this.page;
  }

  async launchBrowser() {
    await this.close(); // Ensure clean state

    const isHeadless = false; // Forced headful for verification
    const chromeFlags = ['--no-sandbox', '--disable-gpu'];
    // if (isHeadless) {
    //   chromeFlags.push('--headless');
    // }

    // Find Chrome
    this.chrome = await chromeLauncher.launch({
      chromeFlags,
    });

    this.browser = await puppeteer.connect({
      browserURL: `http://localhost:${this.chrome.port}`,
      defaultViewport: null, // Allow viewport to resize in headful mode
    });

    // Set a reasonable default if viewport is null (although connect might handle it)
    if (isHeadless) {
      // In headless, we want a fixed viewport. In headful, we let it be window size or fixed.
      // But getPage() sets viewport anyway.
    }
  }

  async close() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (e) {
        debugLogger.warn(`Error closing browser: ${getErrorMessage(e)}`);
      }
      this.browser = null;
      this.page = null;
    }
    if (this.chrome) {
      try {
        this.chrome.kill();
      } catch (e) {
        debugLogger.warn(
          `Error converting chrome process: ${getErrorMessage(e)}`,
        );
      }
      this.chrome = null;
    }
  }
}

class BrowserToolInvocation extends BaseToolInvocation<
  BrowserToolParams,
  ToolResult
> {
  getDescription(): string {
    const action = this.params.action;
    switch (action) {
      case 'open_url':
        return `Open URL: ${this.params.url}`;
      case 'click':
        return `Click at (${this.params.x}, ${this.params.y})`;
      case 'type':
        return `Type text: ${this.params.text}`;
      case 'scroll':
        return `Scroll by (${this.params.delta_x}, ${this.params.delta_y})`;
      case 'get_screenshot':
        return `Get Screenshot`;
      case 'get_html':
        return `Get HTML`;
      case 'close':
        return `Close Browser`;
      default:
        return `Browser Action: ${action}`;
    }
  }

  async execute(_: AbortSignal): Promise<ToolResult> {
    try {
      const manager = BrowserManager.getInstance();

      if (this.params.action === 'close') {
        await manager.close();
        return {
          llmContent: 'Browser closed.',
          returnDisplay: 'Browser closed.',
        };
      }

      const page = await manager.getPage();

      switch (this.params.action) {
        case 'open_url': {
          if (!this.params.url) throw new Error('url is required for open_url');
          await page.goto(this.params.url, { waitUntil: 'networkidle2' });
          break;
        }
        case 'click': {
          if (this.params.x === undefined || this.params.y === undefined) {
            throw new Error('x and y are required for click');
          }
          await page.mouse.click(this.params.x, this.params.y);
          break;
        }
        case 'type': {
          if (this.params.text === undefined)
            throw new Error('text is required for type');
          await page.keyboard.type(this.params.text);
          break;
        }
        case 'scroll': {
          // Puppeteer doesn't have a direct scroll primitive like CDP, but we can evaluate JS or use mouse wheel
          const dx = this.params.delta_x ?? 0;
          const dy = this.params.delta_y ?? 0;
          await page.mouse.wheel({ deltaX: dx, deltaY: dy });
          break;
        }
        case 'get_html': {
          const content = await page.content();
          return {
            llmContent: content,
            returnDisplay: 'HTML Content retrieved',
          };
        }
        case 'get_screenshot': {
          // Handled below
          break;
        }
        default: {
          break;
        }
      }

      // Default return for most actions is a screenshot to show state
      const screenshot = await page.screenshot({
        encoding: 'base64',
        type: 'jpeg',
        quality: 80,
      });
      return {
        llmContent: {
          inlineData: {
            mimeType: 'image/jpeg',
            data: screenshot,
          },
        },
        returnDisplay: 'Action completed. Screenshot captured.',
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      return {
        llmContent: `Error executing browser action: ${errorMessage}`,
        returnDisplay: errorMessage,
        error: {
          message: errorMessage,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

export class BrowserTool extends BaseDeclarativeTool<
  BrowserToolParams,
  ToolResult
> {
  constructor(messageBus: MessageBus) {
    super(
      'browser_tool',
      'Browser Tool',
      'Control a real web browser to navigate pages, click elements, type text, and view content via screenshots. Essential for web tasks.',
      Kind.Other,
      {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: [
              'open_url',
              'click',
              'type',
              'scroll',
              'get_screenshot',
              'get_html',
              'close',
            ],
            description: 'The action to perform.',
          },
          url: {
            type: 'string',
            description: 'The URL to open (required for open_url).',
          },
          x: {
            type: 'number',
            description: 'X coordinate for click (required for click).',
          },
          y: {
            type: 'number',
            description: 'Y coordinate for click (required for click).',
          },
          text: {
            type: 'string',
            description: 'Text to type (required for type).',
          },
          delta_x: {
            type: 'number',
            description: 'Horizontal scroll amount.',
          },
          delta_y: {
            type: 'number',
            description: 'Vertical scroll amount.',
          },
        },
        required: ['action'],
      },
      messageBus,
      false, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  protected createInvocation(
    params: BrowserToolParams,
    messageBus: MessageBus,
    toolName?: string,
    toolDisplayName?: string,
  ): BaseToolInvocation<BrowserToolParams, ToolResult> {
    return new BrowserToolInvocation(
      params,
      messageBus,
      toolName,
      toolDisplayName,
    );
  }
}
