/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ChatEvent {
  chat?: {
    messagePayload?: {
      message?: {
        name?: string;
        argumentText?: string;
        text?: string;
        thread?: { name?: string };
        space?: { name?: string; type?: string };
        sender?: {
          name?: string;
          displayName?: string;
          email?: string;
        };
      };
      space?: { name?: string; type?: string };
    };
  };
  type?: string;
  message?: {
    name?: string;
    text?: string;
    thread?: { name?: string };
    sender?: {
      name?: string;
      displayName?: string;
      email?: string;
    };
  };
  space?: { name?: string; type?: string };
  user?: {
    name?: string;
    displayName?: string;
    email?: string;
  };
}

export interface AgentRequestPacket {
  kind: 'agent-request';
  id: string; // Request ID
  prompt: string;
  spaceName: string;
  threadName: string;
}

export interface AgentResponsePacket {
  kind: 'agent-response';
  id: string; // ID matches request ID
  text?: string;
  error?: string;
  spaceName?: string;
  threadName?: string;
}

export type WebSocketPacket = AgentRequestPacket | AgentResponsePacket;
