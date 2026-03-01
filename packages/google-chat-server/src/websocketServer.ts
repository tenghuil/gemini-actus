/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WebSocketServer, type WebSocket } from 'ws';
import { type IncomingMessage } from 'node:http';
import { GoogleAuth } from 'google-auth-library';
import { logger } from './logger.js';
import { pairingManager } from './pairingManager.js';
import { connectionRegistry } from './connectionRegistry.js';
import type { AgentResponsePacket } from './types.js';

// We need a way to send messages back to Google Chat
// For MVP, we'll just log or use a placeholder if we don't have credentials yet
// In a real implementation, we'd use google-auth-library and fetch to hit Chat API

export function setupWebSocketServer(_server: unknown) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const pairingCode = url.searchParams.get('code');

    if (!pairingCode) {
      logger.warn('Connection attempt without pairing code');
      ws.close(1008, 'Missing pairing code');
      return;
    }

    const userId = pairingManager.validateCode(pairingCode);
    if (!userId) {
      logger.warn(`Invalid or expired pairing code: ${pairingCode}`);
      ws.close(1008, 'Invalid pairing code');
      return;
    }

    // Success! Register connection
    pairingManager.consumeCode(pairingCode); // One-time use? Or keep it valid for a bit? Let's consume it.
    connectionRegistry.registerConnection(userId, ws);

    ws.on('message', async (data) => {
      try {
        const packet = JSON.parse(data.toString()) as AgentResponsePacket;
        if (packet.kind === 'agent-response') {
          logger.info(`Received response from agent for user ${userId}`, {
            id: packet.id,
          });

          if (packet.text && packet.spaceName) {
            try {
              const auth = new GoogleAuth({
                scopes: ['https://www.googleapis.com/auth/chat.bot'],
              });
              const client = await auth.getClient();
              const url = `https://chat.googleapis.com/v1/${packet.spaceName}/messages`;

              const body: Record<string, unknown> = {
                text: packet.text,
              };

              if (packet.threadName) {
                body['thread'] = { name: packet.threadName };
              }

              await client.request({
                url,
                method: 'POST',
                data: body,
              });

              logger.info(`Sent response to Chat space ${packet.spaceName}`);
            } catch (postError) {
              logger.error('Failed to post to Google Chat', postError);
            }
          }
        }
      } catch (e: unknown) {
        logger.error('Error handling message from agent', e);
      }
    });

    ws.on('close', () => {
      connectionRegistry.removeConnection(userId, ws);
    });
  });

  return wss;
}
