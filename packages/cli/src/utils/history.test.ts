/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoryManager } from './history.js';
import fs from 'node:fs/promises';
import path from 'node:path';

vi.mock('node:fs/promises');

describe('HistoryManager', () => {
  const mockWorkspaceRoot = '/tmp/test-workspace';
  let historyManager: HistoryManager;

  beforeEach(() => {
    vi.resetAllMocks();
    historyManager = new HistoryManager(mockWorkspaceRoot);
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('');
    vi.mocked(fs.readdir).mockResolvedValue([]);
    vi.mocked(fs.rm).mockResolvedValue(undefined);
  });

  it('should create a new chat', async () => {
    const chat = await historyManager.createChat('Test Chat');
    expect(chat.title).toBe('Test Chat');
    expect(chat.id).toBeDefined();
    expect(fs.mkdir).toHaveBeenCalledWith(
      expect.stringContaining(path.join('.workspace', chat.id)),
      { recursive: true },
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(path.join('.workspace', chat.id, 'history.json')),
      expect.any(String),
      'utf-8',
    );
  });

  it('should save a chat', async () => {
    const chat = {
      id: 'test-id',
      title: 'Test Chat',
      messages: [],
      lastModified: 1234567890,
    };
    await historyManager.saveChat(chat);
    expect(fs.mkdir).toHaveBeenCalledWith(
      path.join(mockWorkspaceRoot, '.workspace', 'test-id'),
      { recursive: true },
    );
    expect(fs.writeFile).toHaveBeenCalledWith(
      path.join(mockWorkspaceRoot, '.workspace', 'test-id', 'history.json'),
      JSON.stringify(chat, null, 2),
      'utf-8',
    );
  });

  it('should get a chat', async () => {
    const chat = {
      id: 'test-id',
      title: 'Test Chat',
      messages: [],
      lastModified: 1234567890,
    };
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(chat));

    const result = await historyManager.getChat('test-id');
    expect(result).toEqual(chat);
    expect(fs.readFile).toHaveBeenCalledWith(
      path.join(mockWorkspaceRoot, '.workspace', 'test-id', 'history.json'),
      'utf-8',
    );
  });

  it('should get history list', async () => {
    const chat1 = { id: '1', title: 'Chat 1', lastModified: 2000 };
    const chat2 = { id: '2', title: 'Chat 2', lastModified: 1000 };

    vi.mocked(fs.readdir).mockResolvedValue([
      { name: '1', isDirectory: () => true },
      { name: '2', isDirectory: () => true },
      { name: 'file.txt', isDirectory: () => false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);

    vi.mocked(fs.readFile).mockImplementation((filePath) => {
      if (typeof filePath !== 'string')
        return Promise.reject(new Error('ENOENT'));
      if (filePath.includes(path.join('1', 'history.json')))
        return Promise.resolve(JSON.stringify(chat1));
      if (filePath.includes(path.join('2', 'history.json')))
        return Promise.resolve(JSON.stringify(chat2));
      return Promise.reject(new Error('ENOENT'));
    });

    const history = await historyManager.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe('1'); // Sorts by lastModified desc
    expect(history[1].id).toBe('2');
  });

  it('should delete a chat', async () => {
    await historyManager.deleteChat('test-id');
    expect(fs.rm).toHaveBeenCalledWith(
      path.join(mockWorkspaceRoot, '.workspace', 'test-id'),
      { recursive: true, force: true },
    );
  });
});
