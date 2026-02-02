/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  type ToolInvocation,
  type ToolResult,
  Kind,
} from './tools.js';
import { spawn } from 'node:child_process';
import * as net from 'node:net';
import * as path from 'node:path';
import { debugLogger } from '../utils/debugLogger.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { Config } from '../config/config.js';
import { BackgroundProcessManager } from '../services/backgroundProcessManager.js';
import { zodToJsonSchema } from 'zod-to-json-schema';

const inputSchema = z.object({
  command: z
    .string()
    .describe('The command to start the server (e.g., "npm run dev").'),
  request_cwd: z
    .string()
    .optional()
    .describe(
      'The directory to run the command in. Defaults to the project root.',
    ),
  port: z
    .number()
    .default(3000)
    .describe('The port the server is expected to list on.'),
  timeout_ms: z
    .number()
    .default(60_000)
    .describe('Time in milliseconds to wait for the port to become active.'),
});

type WebdevServeToolParams = z.input<typeof inputSchema>;

class WebdevServeToolInvocation extends BaseToolInvocation<
  WebdevServeToolParams,
  ToolResult
> {
  constructor(
    private config: Config,
    params: WebdevServeToolParams,
    messageBus: MessageBus,
  ) {
    super(params, messageBus, WebdevServeTool.Name, 'Webdev Serve');
  }

  getDescription(): string {
    return `Start web server: ${this.params.command}`;
  }

  async execute(): Promise<ToolResult> {
    const {
      command,
      request_cwd: inputCwd,
      port,
      timeout_ms,
    } = inputSchema.parse(this.params);

    // Sanitize CWD
    let cwd: string;
    const projectRoot = this.config.getProjectRoot();

    if (inputCwd) {
      // Resolve absolute path first
      const resolvedCwd = path.isAbsolute(inputCwd)
        ? inputCwd
        : path.resolve(projectRoot, inputCwd);

      if (!this.config.isPathAllowed(resolvedCwd)) {
        const error = this.config.validatePathAccess(resolvedCwd);
        throw new Error(error || 'Invalid cwd path');
      }
      cwd = resolvedCwd;
    } else {
      cwd = projectRoot;
    }

    // Find available port
    const availablePort = await this.findAvailablePort(port);

    debugLogger.log(
      'WebdevServeTool',
      `Starting server: "${command}" in "${cwd}" (waiting for port ${availablePort})`,
    );

    // Spawn process detached
    const subprocess = spawn(command, {
      cwd,
      shell: true,
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        PORT: String(availablePort), // Inject port
        ...this.config.sanitizationConfig.allowedEnvironmentVariables?.reduce(
          (acc, key) => {
            if (process.env[key]) acc[key] = process.env[key];
            return acc;
          },
          {} as Record<string, string | undefined>,
        ),
      },
    });

    if (subprocess.pid) {
      BackgroundProcessManager.getInstance().register(subprocess.pid);
    }

    subprocess.unref();

    if (!subprocess.pid) {
      return {
        llmContent: `Failed to spawn process for command: ${command}`,
        returnDisplay: `Failed to spawn process for command: ${command}`,
        error: {
          message: 'Failed to spawn process',
        },
      };
    }

    const pid = subprocess.pid;

    // Poll for port
    const startTime = Date.now();
    const checkInterval = 500;

    const checkPort = (): Promise<boolean> =>
      new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(200);

        socket
          .on('connect', () => {
            socket.destroy();
            resolve(true);
          })
          .on('timeout', () => {
            socket.destroy();
            resolve(false);
          })
          .on('error', () => {
            socket.destroy();
            resolve(false);
          });

        socket.connect(availablePort, '127.0.0.1');
      });

    try {
      while (Date.now() - startTime < timeout_ms) {
        const isOpen = await checkPort();
        if (isOpen) {
          const msg = `Server started successfully (PID: ${pid}). Listening on port ${availablePort}. command: "${command}"`;
          return {
            llmContent: msg,
            returnDisplay: msg,
          };
        }
        await new Promise((r) => setTimeout(r, checkInterval));

        try {
          process.kill(pid, 0);
        } catch (_e) {
          const msg = `Server process exited unexpectedly with PID ${pid} before port ${availablePort} was open.`;
          return {
            llmContent: msg,
            returnDisplay: msg,
            error: {
              message: `Process ${pid} exited early`,
            },
          };
        }
      }

      // Timeout reached
      try {
        process.kill(-pid, 'SIGKILL');
      } catch (_e) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (_) {
          // ignore
        }
      }

      const msg = `Timeout waiting for port ${availablePort} to open after ${timeout_ms}ms. Process ${pid} killed.`;
      return {
        llmContent: msg,
        returnDisplay: msg,
        error: {
          message: 'Timeout waiting for port',
        },
      };
    } catch (error) {
      const msg = `Unexpected error starting server: ${error}`;
      return {
        llmContent: msg,
        returnDisplay: msg,
        error: {
          message: String(error),
        },
      };
    }
  }

  private async findAvailablePort(startPort: number): Promise<number> {
    const isPortAvailable = (port: number): Promise<boolean> =>
      new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
      });

    let port = startPort;
    // Try next 10 ports
    for (let i = 0; i < 10; i++) {
      if (await isPortAvailable(port)) {
        return port;
      }
      port++;
    }
    throw new Error(
      `Could not find an available port starting from ${startPort} (checked 10 ports)`,
    );
  }
}

export class WebdevServeTool extends BaseDeclarativeTool<
  WebdevServeToolParams,
  ToolResult
> {
  static Name = 'webdev_serve';

  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    super(
      WebdevServeTool.Name,
      'Webdev Serve',
      `Start a web server in the background. 
This tool starts a long-running process (like 'npm run dev' or 'python3 -m http.server') and waits for a specific port to become active.
It ensures the server is running without blocking the agent's main execution loop.
Use this when you need to preview a web app or run a local API server.`,
      Kind.Execute,
      zodToJsonSchema(inputSchema),
      messageBus,
    );
  }

  createInvocation(
    params: WebdevServeToolParams,
    messageBus: MessageBus,
  ): ToolInvocation<WebdevServeToolParams, ToolResult> {
    return new WebdevServeToolInvocation(this.config, params, messageBus);
  }
}
