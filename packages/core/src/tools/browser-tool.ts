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
import type { Config } from '../config/config.js';
import { isPortOpen } from '../utils/port-utils.js';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

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
  selector?: string;
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

  private constructor(private readonly config: Config) {}

  static getInstance(config: Config): BrowserManager {
    if (!BrowserManager.instance) {
      BrowserManager.instance = new BrowserManager(config);
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

    const isHeadless = false; // Use headless for server environments
    const chromeFlags = [
      '--no-sandbox',
      '--disable-gpu',
      '--allow-insecure-localhost',
      '--disable-web-security',
    ];
    if (isHeadless) {
      chromeFlags.push('--headless');
    }

    // Find Chrome
    if (typeof this.config.browserUserDataDir === 'string') {
      try {
        fs.mkdirSync(this.config.browserUserDataDir, { recursive: true });
      } catch (e) {
        debugLogger.warn(`Error creating user data dir: ${getErrorMessage(e)}`);
      }
    }

    this.chrome = await chromeLauncher.launch({
      chromeFlags,
      userDataDir: this.config.browserUserDataDir || true,
    });

    this.browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${this.chrome.port}`,
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
  constructor(
    private readonly config: Config,
    params: BrowserToolParams,
    messageBus: MessageBus,
    toolName?: string,
    toolDisplayName?: string,
  ) {
    super(params, messageBus, toolName, toolDisplayName);
  }
  getDescription(): string {
    const action = this.params.action;
    switch (action) {
      case 'open_url':
        return `Open URL: ${this.params.url}`;
      case 'click':
        if (this.params.selector) {
          return `Click element: ${this.params.selector}`;
        }
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
      const manager = BrowserManager.getInstance(this.config);

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

          const url = new URL(this.params.url);
          if (
            url.hostname === 'localhost' ||
            url.hostname === '127.0.0.1' ||
            url.hostname === '0.0.0.0'
          ) {
            const port = parseInt(url.port || '80', 10);
            const isOpen = await isPortOpen(port, url.hostname);
            if (!isOpen) {
              debugLogger.log(
                `Local port ${port} is closed. Attempting auto-startup...`,
              );
              await this.attemptAutoStartup(port);
              // Wait a bit for the server to potentially start
              let retries = 10;
              while (retries > 0) {
                if (await isPortOpen(port, url.hostname)) {
                  break;
                }
                await new Promise((resolve) => setTimeout(resolve, 1000));
                retries--;
              }
            }
          }

          await page.goto(this.params.url, { waitUntil: 'networkidle2' });
          break;
        }
        case 'click': {
          if (this.params.selector) {
            await page.click(this.params.selector);
          } else if (
            this.params.x !== undefined &&
            this.params.y !== undefined
          ) {
            await page.mouse.click(this.params.x, this.params.y);
          } else {
            throw new Error(
              'Either selector or x and y are required for click',
            );
          }
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

  private async attemptAutoStartup(port: number) {
    const targetDir = this.config.getTargetDir();
    const pkgJsonPath = path.join(targetDir, 'package.json');

    let command = '';
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
        if (pkgJson.scripts?.dev) {
          command = 'npm run dev';
        } else if (pkgJson.scripts?.start) {
          command = 'npm start';
        }
      } catch (e) {
        debugLogger.error(`Error reading package.json: ${getErrorMessage(e)}`);
      }
    }

    if (!command) {
      debugLogger.warn('No suitable start script found in package.json');
      return;
    }

    debugLogger.log(`Starting background server with command: ${command}`);
    const [cmd, ...args] = command.split(' ');
    const child = spawn(cmd, args, {
      cwd: targetDir,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PORT: port.toString() },
    });
    child.unref();
  }
}

export class BrowserTool extends BaseDeclarativeTool<
  BrowserToolParams,
  ToolResult
> {
  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
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
          selector: {
            type: 'string',
            description: 'CSS selector to click (optional for click).',
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
      this.config,
      params,
      messageBus,
      toolName,
      toolDisplayName,
    );
  }
}
