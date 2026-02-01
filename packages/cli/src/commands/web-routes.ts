/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type express from 'express';
import path from 'node:path';
import { debugLogger } from '@google/gemini-actus-core';

export async function setupFileSystemRoutes(app: express.Express) {
  const fs = await import('node:fs/promises');

  // Helper to find the real workspace root (handling monorepo structure)
  const findWorkspaceRoot = async () => {
    // Check cwd
    const cwd = process.cwd();
    const localWorkspace = path.join(cwd, '.workspace');
    try {
      await fs.access(localWorkspace);
      return cwd;
    } catch {
      // ignore
    }

    // Check 2 levels up (repo root from packages/cli)
    const repoRoot = path.resolve(cwd, '../..');
    const repoWorkspace = path.join(repoRoot, '.workspace');
    try {
      await fs.access(repoWorkspace);
      return repoRoot;
    } catch {
      // ignore
    }

    // Default to cwd if neither found
    return cwd;
  };

  const getWorkspacePath = async (chatId?: string) => {
    const root = await findWorkspaceRoot();
    if (chatId) {
      return path.join(root, '.workspace', chatId);
    }
    return root;
  };

  app.get('/api/files/list', async (req, res) => {
    try {
      const chatId = req.query['chatId'] as string | undefined;
      const rootDir = await getWorkspacePath(chatId);

      // Check if directory exists first
      try {
        await fs.access(rootDir);
      } catch {
        if (chatId) {
          res.json([]);
          return;
        }
      }

      // constant simple ignore list for now
      const ignore = [
        '.git',
        'node_modules',
        'dist',
        '.next',
        '.DS_Store',
        '.workspace',
        'history.json',
      ];

      interface FileEntry {
        name: string;
        path: string;
        type: 'directory' | 'file';
        children?: FileEntry[];
      }

      async function getFiles(dir: string): Promise<FileEntry[]> {
        const dirents = await fs.readdir(dir, { withFileTypes: true });
        const files = await Promise.all(
          dirents.map(async (dirent) => {
            if (ignore.includes(dirent.name)) return null;
            const res = path.resolve(dir, dirent.name);
            const relativePath = path.relative(rootDir, res);

            if (dirent.isDirectory()) {
              return {
                name: dirent.name,
                path: relativePath,
                type: 'directory',
                children: await getFiles(res),
              };
            } else {
              return {
                name: dirent.name,
                path: relativePath,
                type: 'file',
              };
            }
          }),
        );
        return files.filter(Boolean) as FileEntry[];
      }

      const files = await getFiles(rootDir);
      res.json(files);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.post('/api/files/read', async (req, res) => {
    try {
      const { path: filePath, chatId } = req.body as {
        path: string;
        chatId?: string;
      };
      if (!filePath) {
        res.status(400).json({ error: 'Path is required' });
        return;
      }

      const rootDir = await getWorkspacePath(chatId);
      const safePath = path.resolve(rootDir, filePath);

      if (!safePath.startsWith(rootDir)) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      const content = await fs.readFile(safePath, 'utf-8');
      res.json({ content });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Validates if a file exists to avoid trying to index.html fallback for preview files
  app.use('/preview', async (req, res, next) => {
    if (req.method !== 'GET') return next();

    try {
      const parts = req.path.split('/').filter(Boolean);
      // Expected format: /chatId/filePath...
      if (parts.length < 2) return next();

      const potentialChatId = parts[0];
      const filePath = '/' + parts.slice(1).join('/');

      debugLogger.log(`Preview request: ${req.path}`);

      const workspaceRoot = await findWorkspaceRoot();
      const sessionDir = path.join(
        workspaceRoot,
        '.workspace',
        potentialChatId,
      );

      // Check if this is a valid session directory
      try {
        await fs.access(sessionDir);
      } catch {
        debugLogger.log(`Session dir not found: ${sessionDir}`);
        // Not a session directory, pass to next handler (e.g. might be a static route)
        return next();
      }

      // If we are here, it IS a valid session. We should handle the request definitively.
      const file = path.join(sessionDir, filePath);
      debugLogger.log(`Attempting to serve: ${file}`);

      // Security check: ensure file is within sessionDir
      if (!path.resolve(file).startsWith(path.resolve(sessionDir))) {
        res.status(403).send('Access denied');
        return;
      }

      try {
        await fs.access(file);
        res.sendFile(file, { dotfiles: 'allow' }, (err) => {
          if (err) {
            if (!res.headersSent) res.status(500).send('Error serving file');
          }
        });
      } catch {
        debugLogger.log(`File not found: ${file}`);
        // File not found IN THE SESSION
        res.status(404).send(`File not found in session: ${filePath}`);
      }
    } catch (err) {
      debugLogger.error('Preview middleware error:', err);
      next(err);
    }
  });
}
