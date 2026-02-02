/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import { WebdevServeTool } from './webdev-serve.js';
import { createMockMessageBus } from '../test-utils/mock-message-bus.js';
import type { Config } from '../config/config.js';
import * as child_process from 'node:child_process';
import * as net from 'node:net';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

// Mock node:child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Mock node:net
vi.mock('node:net', () => ({
  Socket: vi.fn(),
  createServer: vi.fn(),
}));

// Mock BackgroundProcessManager
vi.mock('../services/backgroundProcessManager.js', () => ({
  BackgroundProcessManager: {
    getInstance: vi.fn().mockReturnValue({
      register: vi.fn(),
      unregister: vi.fn(),
    }),
  },
}));

describe('WebdevServeTool', () => {
  let tool: WebdevServeTool;
  let mockConfig: Config;
  let messageBus: MessageBus;

  beforeEach(() => {
    vi.clearAllMocks();
    messageBus = createMockMessageBus();
    mockConfig = {
      isPathAllowed: vi.fn().mockReturnValue(true),
      validatePathAccess: vi.fn().mockReturnValue(null),
      getProjectRoot: vi.fn().mockReturnValue('/mock/root'),
      sanitizationConfig: {
        allowedEnvironmentVariables: ['PATH'],
      },
    } as unknown as Config;

    tool = new WebdevServeTool(mockConfig, messageBus);

    // Default mock server factory
    (net.createServer as unknown as Mock).mockImplementation(() => {
      const server = {
        listen: vi.fn(),
        once: vi.fn(),
        close: vi.fn((cb) => cb && cb()),
      };
      server.listen.mockImplementation(() => {
        // Default success (async to match real life)
        setTimeout(() => {
          const listeningHandler = server.once.mock.calls.find(
            (c: unknown[]) => c[0] === 'listening',
          )?.[1];
          if (listeningHandler) listeningHandler();
        }, 0);
      });
      return server;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start server and detect port open', async () => {
    const mockUnref = vi.fn();
    const mockPid = 12345;
    (child_process.spawn as unknown as Mock).mockReturnValue({
      pid: mockPid,
      unref: mockUnref,
    });

    // Mock Socket to simulate connection success
    const mockSocket = {
      connect: vi.fn(),
      on: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
      setTimeout: vi.fn(),
    };
    (net.Socket as unknown as Mock).mockImplementation(() => mockSocket);

    mockSocket.on.mockImplementation((event, handler) => {
      if (event === 'connect') {
        setTimeout(handler, 10);
      }
      return mockSocket;
    });

    const invocation = tool.build({
      command: 'npm run dev',
      port: 3000,
      timeout_ms: 1000,
    });

    const result = await invocation.execute(new AbortController().signal);

    expect(result.llmContent).toContain('Server started successfully');
    expect(result.llmContent).toContain('PID: 12345');
    expect(child_process.spawn).toHaveBeenCalledWith(
      'npm run dev',
      expect.objectContaining({
        detached: true,
        cwd: '/mock/root',
        env: expect.objectContaining({
          PORT: '3000',
        }),
      }),
    );

    // Verify BackgroundProcessManager was called
    const { BackgroundProcessManager } = await import(
      '../services/backgroundProcessManager.js'
    );
    expect(
      BackgroundProcessManager.getInstance().register,
    ).toHaveBeenCalledWith(mockPid);
  });

  it('should resolve relative cwd against project root', async () => {
    const mockUnref = vi.fn();
    (child_process.spawn as unknown as Mock).mockReturnValue({
      pid: 12345,
      unref: mockUnref,
    });

    const mockSocket = {
      connect: vi.fn(),
      on: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
      setTimeout: vi.fn(),
    };
    (net.Socket as unknown as Mock).mockImplementation(() => mockSocket);
    mockSocket.on.mockImplementation((event, handler) => {
      if (event === 'connect') setTimeout(handler, 10);
      return mockSocket;
    });

    const invocation = tool.build({
      command: 'npm run dev',
      request_cwd: 'relative/path',
      port: 3000,
      timeout_ms: 1000,
    });

    await invocation.execute(new AbortController().signal);

    expect(child_process.spawn).toHaveBeenCalledWith(
      'npm run dev',
      expect.objectContaining({
        cwd: '/mock/root/relative/path',
      }),
    );
  });

  it('should find next available port if requested port is in use', async () => {
    const mockUnref = vi.fn();
    (child_process.spawn as unknown as Mock).mockReturnValue({
      pid: 12345,
      unref: mockUnref,
    });

    // Override createServer for this test
    (net.createServer as unknown as Mock).mockImplementation(() => {
      const server = {
        listen: vi.fn(),
        once: vi.fn(),
        close: vi.fn((cb) => cb && cb()),
      };
      server.listen.mockImplementation((port: number) => {
        setTimeout(() => {
          if (port === 3000) {
            const errorHandler = server.once.mock.calls.find(
              (c: unknown[]) => c[0] === 'error',
            )?.[1];
            if (errorHandler) errorHandler(new Error('EADDRINUSE'));
          } else {
            const listeningHandler = server.once.mock.calls.find(
              (c: unknown[]) => c[0] === 'listening',
            )?.[1];
            if (listeningHandler) listeningHandler();
          }
        }, 0);
      });
      return server;
    });

    const mockSocket = {
      connect: vi.fn(),
      on: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
      setTimeout: vi.fn(),
    };
    (net.Socket as unknown as Mock).mockImplementation(() => mockSocket);
    mockSocket.on.mockImplementation((event, handler) => {
      if (event === 'connect') setTimeout(handler, 10);
      return mockSocket;
    });

    const invocation = tool.build({
      command: 'npm run dev',
      port: 3000,
      timeout_ms: 1000,
    });

    const result = await invocation.execute(new AbortController().signal);

    expect(result.llmContent).toContain('Listening on port 3001');
    expect(child_process.spawn).toHaveBeenCalledWith(
      'npm run dev',
      expect.objectContaining({
        env: expect.objectContaining({
          PORT: '3001',
        }),
      }),
    );
  });

  it('should timeout if port never opens', async () => {
    vi.useFakeTimers();
    const mockUnref = vi.fn();
    const mockKill = vi.fn();
    const mockPid = 12345;

    // Mock process.kill
    vi.spyOn(process, 'kill').mockImplementation(mockKill);

    (child_process.spawn as unknown as Mock).mockReturnValue({
      pid: mockPid,
      unref: mockUnref,
    });

    // Mock Socket to simulate timeout/error
    const mockSocket = {
      connect: vi.fn(),
      on: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
      setTimeout: vi.fn(),
    };
    (net.Socket as unknown as Mock).mockImplementation(() => mockSocket);

    // Always fail connection
    mockSocket.on.mockImplementation((event, handler) => {
      if (event === 'error') {
        setTimeout(handler, 10);
      }
      return mockSocket;
    });

    const invocation = tool.build({
      command: 'npm run dev',
      port: 3000,
      timeout_ms: 2000,
    });

    const callPromise = invocation.execute(new AbortController().signal);

    // Fast-forward time
    await vi.runAllTimersAsync();

    const result = await callPromise;
    expect(result.llmContent).toContain('Timeout waiting for port');
    expect(result.error).toBeDefined();
    // Verify cleanup attempted
    expect(process.kill).toHaveBeenCalled();
  });

  it('should handle process immediate exit', async () => {
    vi.useFakeTimers();
    const mockUnref = vi.fn();
    const mockPid = 12345;

    // Mock process.kill to throw (simulating process gone)
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('ESRCH');
    });

    (child_process.spawn as unknown as Mock).mockReturnValue({
      pid: mockPid,
      unref: mockUnref,
    });

    // Mock Socket to fail
    const mockSocket = {
      connect: vi.fn(),
      on: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
      setTimeout: vi.fn(),
    };
    (net.Socket as unknown as Mock).mockImplementation(() => mockSocket);

    mockSocket.on.mockImplementation((event, handler) => {
      if (event === 'error') {
        setTimeout(handler, 10);
      }
      return mockSocket;
    });

    const invocation = tool.build({
      command: 'npm run dev',
      port: 3000,
      timeout_ms: 2000,
    });

    const callPromise = invocation.execute(new AbortController().signal);

    // Advance time a bit, allowing the loop to check process.kill
    await vi.advanceTimersByTimeAsync(600);

    const result = await callPromise;
    expect(result.llmContent).toContain('Server process exited unexpectedly');
  });
});
