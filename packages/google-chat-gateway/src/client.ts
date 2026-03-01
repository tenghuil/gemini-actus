/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import WebSocket from 'ws';
import type { ClientOptions } from 'ws';
import { logger } from './logger.js';
import { askAgent } from './agentClient.js';
import type { AgentRequestPacket, AgentResponsePacket } from './types.js';

export class GatewayClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pairingCode: string;
  private serverUrl: string;
  private token?: string;

  constructor(serverUrl: string, pairingCode: string, token?: string) {
    this.serverUrl = serverUrl;
    this.pairingCode = pairingCode;
    this.token = token;
  }

  connect() {
    const url = `${this.serverUrl}?code=${this.pairingCode}`;
    logger.info(`Connecting to ${this.serverUrl}...`);

    const options: ClientOptions = {};
    if (this.token) {
      options.headers = {
        Authorization: `Bearer ${this.token}`,
      };
    }

    // Debug logging for connection options
    logger.info(`WebSocket Options: ${JSON.stringify(options, null, 2)}`);

    this.ws = new WebSocket(url, options);

    this.ws.on('open', () => {
      logger.info('Connected to Google Chat Server');
      // Clear any reconnect timer if we successfully connected
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    });

    this.ws.on('message', async (data) => {
      try {
        const packet = JSON.parse(data.toString()) as AgentRequestPacket;
        if (packet.kind === 'agent-request') {
          logger.info(`Received prompt: ${packet.prompt}`);

          // Execute Agent Logic
          const response = await askAgent(packet.prompt);

          // Send Response back
          const reply: AgentResponsePacket = {
            kind: 'agent-response',
            id: packet.id,
            text: response.text,
            spaceName: packet.spaceName,
            threadName: packet.threadName,
          };
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(reply));
          } else {
            logger.warn('Cannot send response: WebSocket not open');
          }
        }
      } catch (e) {
        logger.error('Error handling message from server', e);
      }
    });

    this.ws.on('close', (code, reason) => {
      logger.warn(`Connection closed: ${code} - ${reason}`);
      this.ws = null;
      if (code === 1008) {
        logger.error('Invalid pairing code. Please generate a new one.');
        process.exit(1);
      } else {
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (err) => {
      logger.error('Connection error', err);
      // 'close' event usually follows 'error', so we rely on that for reconnect logic
      // but just in case:
      if (!this.ws) {
        this.scheduleReconnect();
      }
    });
  }

  private scheduleReconnect() {
    if (!this.reconnectTimer) {
      logger.info('Scheduling reconnect in 5s...');
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, 5000);
    }
  }
}
