/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AgentRequestPacket {
  kind: 'agent-request';
  id: string;
  prompt: string;
  spaceName: string;
  threadName: string;
}

export interface AgentResponsePacket {
  kind: 'agent-response';
  id: string;
  text?: string;
  error?: string;
  spaceName?: string;
  threadName?: string;
}
