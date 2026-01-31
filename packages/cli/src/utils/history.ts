/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { debugLogger } from '@google/gemini-actus-core';

export interface ChatMessage {
  role: 'user' | 'model' | 'error';
  text: string;
  thoughts?: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  lastModified: number;
}

export class HistoryManager {
  private workspaceRoot: string;

  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
  }

  private getSessionDir(id: string): string {
    return path.join(this.workspaceRoot, '.workspace', id);
  }

  private getHistoryDetailsPath(id: string): string {
    return path.join(this.getSessionDir(id), 'history.json');
  }

  async getHistory(): Promise<
    Array<{ id: string; title: string; lastModified: number }>
  > {
    const workspaceDir = path.join(this.workspaceRoot, '.workspace');
    try {
      const entries = await fs.readdir(workspaceDir, { withFileTypes: true });
      const sessions = await Promise.all(
        entries
          .filter((entry) => entry.isDirectory())
          .map(async (entry) => {
            try {
              const historyPath = path.join(
                workspaceDir,
                entry.name,
                'history.json',
              );
              const data = await fs.readFile(historyPath, 'utf-8');
              const session: ChatSession = JSON.parse(data);
              return {
                id: session.id,
                title: session.title,
                lastModified: session.lastModified,
              };
            } catch (_e) {
              // Ignore invalid/missing history files
              return null;
            }
          }),
      );
      return sessions
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .filter((s): s is NonNullable<typeof s> => s !== null)
        .sort((a, b) => b.lastModified - a.lastModified);
    } catch (e) {
      if ((e as { code?: string }).code === 'ENOENT') {
        return [];
      }
      debugLogger.error('Failed to list history:', e);
      return [];
    }
  }

  async getChat(id: string): Promise<ChatSession | undefined> {
    try {
      const historyPath = this.getHistoryDetailsPath(id);
      const data = await fs.readFile(historyPath, 'utf-8');
      return JSON.parse(data);
    } catch (e) {
      if ((e as { code?: string }).code !== 'ENOENT') {
        debugLogger.error(`Failed to read chat ${id}:`, e);
      }
      return undefined;
    }
  }

  async saveChat(chat: ChatSession): Promise<void> {
    const sessionDir = this.getSessionDir(chat.id);
    const historyPath = this.getHistoryDetailsPath(chat.id);
    try {
      await fs.mkdir(sessionDir, { recursive: true });
      await fs.writeFile(historyPath, JSON.stringify(chat, null, 2), 'utf-8');
    } catch (e) {
      debugLogger.error(`Failed to save chat ${chat.id}:`, e);
      throw e;
    }
  }

  async deleteChat(id: string): Promise<void> {
    const sessionDir = this.getSessionDir(id);
    try {
      await fs.rm(sessionDir, { recursive: true, force: true });
    } catch (e) {
      debugLogger.error(`Failed to delete chat ${id}:`, e);
      throw e;
    }
  }

  async createChat(title = 'New Chat'): Promise<ChatSession> {
    const id = crypto.randomUUID();
    const chat: ChatSession = {
      id,
      title,
      messages: [],
      lastModified: Date.now(),
    };
    await this.saveChat(chat);
    return chat;
  }

  async addMessage(chatId: string, message: ChatMessage): Promise<void> {
    const chat = await this.getChat(chatId);
    if (chat) {
      chat.messages.push(message);
      chat.lastModified = Date.now();

      // Auto-update title if it's the first user message and title is default
      if (
        message.role === 'user' &&
        chat.messages.filter((m) => m.role === 'user').length === 1 &&
        chat.title === 'New Chat'
      ) {
        chat.title =
          message.text.slice(0, 30) + (message.text.length > 30 ? '...' : '');
      }

      await this.saveChat(chat);
    } else {
      debugLogger.error(
        `Attempted to add message to non-existent chat ${chatId}`,
      );
    }
  }
}
