/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WebSocket } from 'ws';
import type { AgentConnection, AgentRequestPacket } from './types.js';
import { logger } from './logger.js';

export class ConnectionRegistry {
  // Map<UserID, AgentConnection>
  private connections = new Map<string, AgentConnection>();

  registerConnection(userId: string, socket: WebSocket) {
    // If there's an existing connection, we might want to close it or overwrite it
    const existing = this.connections.get(userId);
    if (existing) {
      logger.info(`Replacing existing connection for user ${userId}`);
      try {
        existing.socket.close();
      } catch (e) {
        logger.warn(`Error closing old socket for user ${userId}`, e);
      }
    }

    this.connections.set(userId, {
      socket,
      userId,
      connectedAt: new Date(),
    });
    logger.info(`Registered connection for user ${userId}`);

    socket.on('close', () => {
      this.removeConnection(userId, socket);
    });
  }

  removeConnection(userId: string, socket: WebSocket) {
    const current = this.connections.get(userId);
    if (current && current.socket === socket) {
      this.connections.delete(userId);
      logger.info(`Removed connection for user ${userId}`);
    }
  }

  getConnection(userId: string): AgentConnection | undefined {
    return this.connections.get(userId);
  }

  sendToUser(userId: string, packet: AgentRequestPacket): boolean {
    const connection = this.connections.get(userId);
    if (!connection) {
      return false;
    }

    if (connection.socket.readyState !== WebSocket.OPEN) {
      logger.warn(`Socket for user ${userId} is not open`);
      this.connections.delete(userId);
      return false;
    }

    connection.socket.send(JSON.stringify(packet));
    return true;
  }
}

export const connectionRegistry = new ConnectionRegistry();
