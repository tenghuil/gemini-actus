/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
import path from 'node:path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

import { app } from './httpServer.js';
import { setupWebSocketServer } from './websocketServer.js';
import { logger } from './logger.js';
import { createServer } from 'node:http';

const port = process.env['PORT'] || 8080; // Cloud Run default is 8080

const server = createServer(app);

// Attach WebSocket Server
const wss = setupWebSocketServer(server);

server.on('upgrade', (req, socket, head) => {
  logger.info(`[Upgrade Request] URL: ${req.url}`);
  logger.info(`[Upgrade Request] Headers: ${JSON.stringify(req.headers)}`);

  // Manual upgrade
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

server.listen(port, () => {
  logger.info(`[Google Chat Server] Listening on port ${port}`);
});
