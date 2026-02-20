/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WebSocketServer, WebSocket } from 'ws';
import { debugLogger } from '../utils/debugLogger.js';
import { ToolErrorType } from '../tools/tool-error.js';

export interface ExtensionCommand {
  id: string;
  command: string;
  params: unknown;
}

export interface ExtensionResponse {
  id: string;
  result?: unknown;
  error?: string;
}

export class ExtensionBridge {
  private wss: WebSocketServer | null = null;
  private socket: WebSocket | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
  >();
  private static instance: ExtensionBridge;

  private constructor(private port: number = 41243) {}

  static getInstance(): ExtensionBridge {
    if (!ExtensionBridge.instance) {
      ExtensionBridge.instance = new ExtensionBridge();
    }
    return ExtensionBridge.instance;
  }

  async startServer(): Promise<void> {
    if (this.wss) return;

    return new Promise((resolve) => {
      this.wss = new WebSocketServer({ port: this.port, host: '127.0.0.1' });
      debugLogger.log(
        `ExtensionBridge WebSocket server started on ws://127.0.0.1:${this.port}`,
      );

      this.wss.on('connection', (ws) => {
        debugLogger.log('ExtensionBridge: Extension connected');
        this.socket = ws;

        ws.on('message', (data) => {
          try {
            const response = JSON.parse(data.toString()) as ExtensionResponse;
            if (response.id && this.pendingRequests.has(response.id)) {
              const { resolve, reject } = this.pendingRequests.get(
                response.id,
              )!;
              this.pendingRequests.delete(response.id);
              if (response.error) {
                reject(new Error(response.error));
              } else {
                resolve(response.result);
              }
            } else if (
              response.result &&
              (response.result as { type?: string }).type === 'hello'
            ) {
              debugLogger.log('ExtensionBridge: Handshake received');
            }
          } catch (e) {
            debugLogger.error('ExtensionBridge: Error processing message', e);
          }
        });

        ws.on('close', () => {
          debugLogger.log('ExtensionBridge: Extension disconnected');
          this.socket = null;
        });
      });

      resolve();
    });
  }

  get isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  async waitForConnection(timeoutMs: number): Promise<boolean> {
    if (this.isConnected) return true;

    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.isConnected) {
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          resolve(true);
        }
      }, 500);

      const timeoutId = setTimeout(() => {
        clearInterval(checkInterval);
        resolve(this.isConnected);
      }, timeoutMs);
    });
  }

  async sendCommand(command: string, params: unknown = {}): Promise<unknown> {
    if (!this.isConnected) {
      // Wait a bit for connection?
      throw new Error(
        `Browser extension not connected. Please ensure the extension is installed and running. (${ToolErrorType.EXECUTION_FAILED})`,
      );
    }

    const id = Math.random().toString(36).substring(7);
    const request: ExtensionCommand = { id, command, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.socket!.send(JSON.stringify(request));

      // Timeout
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Extension request timed out'));
        }
      }, 30000);
    });
  }

  async stop(): Promise<void> {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}
