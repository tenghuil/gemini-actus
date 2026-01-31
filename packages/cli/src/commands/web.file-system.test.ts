/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction, Express } from 'express';
import { setupFileSystemRoutes } from './web-routes.js';
import path from 'node:path';

// Mock fs/promises
const mockReaddir = vi.fn();
const mockReadFile = vi.fn();
const mockStat = vi.fn();

const mockAccess = vi.fn();

vi.mock('node:fs/promises', async () => ({
  default: {
    readdir: mockReaddir,
    readFile: mockReadFile,
    stat: mockStat,
    access: mockAccess,
  },
  readdir: mockReaddir,
  readFile: mockReadFile,
  stat: mockStat,
  access: mockAccess,
}));

describe('FileSystem Routes', () => {
  let app: Express;
  let mockReq: Request;
  let mockRes: Response;
  let mockNext: NextFunction;
  let handlers: Record<string, (...args: unknown[]) => unknown> = {};

  beforeEach(() => {
    vi.resetAllMocks();
    handlers = {};

    app = {
      get: vi.fn((path, handler) => {
        handlers[`GET ${path}`] = handler;
      }),
      post: vi.fn((path, handler) => {
        handlers[`POST ${path}`] = handler;
      }),
      delete: vi.fn(),
      use: vi.fn((pathOrHandler, handler) => {
        if (typeof pathOrHandler === 'string') {
          handlers[`USE ${pathOrHandler}`] = handler;
        } else {
          handlers['USE_GLOBAL'] = pathOrHandler;
        }
      }),
    } as unknown as Express;

    mockReq = {
      query: {},
      body: {},
      params: {},
      path: '',
      method: 'GET',
    } as unknown as Request;

    mockRes = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
      sendFile: vi.fn(),
      setHeader: vi.fn(),
      write: vi.fn(),
    } as unknown as Response;

    mockNext = vi.fn();
  });

  it('should list files from root when no chatId is provided', async () => {
    await setupFileSystemRoutes(app);

    mockReaddir.mockResolvedValue([
      { name: 'file1.txt', isDirectory: () => false },
      { name: 'dir1', isDirectory: () => true },
    ]);

    // We need to mock the recursive call for dir1
    mockReaddir.mockImplementation(async (path) => {
      if (path === process.cwd()) {
        return [
          { name: 'file1.txt', isDirectory: () => false },
          { name: 'dir1', isDirectory: () => true },
        ];
      }
      if (path.endsWith('dir1')) {
        return [];
      }
      return [];
    });

    const handler = handlers['GET /api/files/list'];
    expect(handler).toBeDefined();

    await handler(mockReq, mockRes);

    expect(mockReaddir).toHaveBeenCalledWith(process.cwd(), {
      withFileTypes: true,
    });
    expect(mockRes.json).toHaveBeenCalled();
  });

  it('should list files from session workspace when chatId is provided', async () => {
    await setupFileSystemRoutes(app);

    mockReq.query = { chatId: 'test-session' };
    mockReaddir.mockResolvedValue([
      { name: 'session-file.txt', isDirectory: () => false },
    ]);

    const handler = handlers['GET /api/files/list'];
    await handler(mockReq, mockRes);

    const expectedPath = path.join(process.cwd(), '.workspace', 'test-session');
    expect(mockReaddir).toHaveBeenCalledWith(expectedPath, {
      withFileTypes: true,
    });
  });

  it('should exclude history.json from file list', async () => {
    await setupFileSystemRoutes(app);

    mockReq.query = { chatId: 'test-session' };
    mockReaddir.mockResolvedValue([
      { name: 'session-file.txt', isDirectory: () => false },
      { name: 'history.json', isDirectory: () => false },
    ]);

    const handler = handlers['GET /api/files/list'];
    await handler(mockReq, mockRes);

    expect(mockRes.json).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'session-file.txt' }),
    ]);
    expect(mockRes.json).not.toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: 'history.json' }),
      ]),
    );
  });

  it('should read file from session workspace when chatId is provided', async () => {
    await setupFileSystemRoutes(app);

    mockReq.body = { path: 'test.html', chatId: 'test-session' };
    mockReadFile.mockResolvedValue('content');

    const handler = handlers['POST /api/files/read'];
    expect(handler).toBeDefined();

    await handler(mockReq, mockRes);

    const expectedPath = path.join(
      process.cwd(),
      '.workspace',
      'test-session',
      'test.html',
    );
    expect(mockReadFile).toHaveBeenCalledWith(expectedPath, 'utf-8');
    expect(mockRes.json).toHaveBeenCalledWith({ content: 'content' });
  });

  it('should serve preview file from session workspace', async () => {
    await setupFileSystemRoutes(app);

    mockReq.method = 'GET';
    const chatId = 'test-session';
    (mockReq as unknown as { path: string }).path = `/${chatId}/index.html`;

    mockAccess.mockImplementation(async (checkPath) => {
      // Check if it's the workspace access check
      if (checkPath === path.join(process.cwd(), '.workspace', chatId)) {
        return; // success
      }
      // Check if it's the file access check
      if (
        checkPath ===
        path.join(process.cwd(), '.workspace', chatId, 'index.html')
      ) {
        return; // success
      }
      throw new Error('ENOENT');
    });

    const handler = handlers['USE /preview'];
    expect(handler).toBeDefined();

    await handler(mockReq, mockRes, mockNext);

    const expectedPath = path.join(
      process.cwd(),
      '.workspace',
      chatId,
      'index.html',
    );
    expect(mockRes.sendFile).toHaveBeenCalledWith(
      expectedPath,
      expect.anything(),
    );
  });
});
