/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  RestTransportFactory,
  JsonRpcTransportFactory,
} from '@a2a-js/sdk/client';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';

export interface AgentResponse {
  text: string;
}

export async function askAgent(
  prompt: string,
  sessionId?: string,
): Promise<AgentResponse> {
  try {
    const port = process.env['CODER_AGENT_PORT'] || '41242';
    // The A2A server serves the card at this specific path
    const agentCardUrl = `http://localhost:${port}/.well-known/agent-card.json`;

    // In node >= 20, fetch is globally available
    const resolver = new DefaultAgentCardResolver({ fetchImpl: fetch });
    const options = ClientFactoryOptions.createFrom(
      ClientFactoryOptions.default,
      {
        transports: [
          new RestTransportFactory({ fetchImpl: fetch }),
          new JsonRpcTransportFactory({ fetchImpl: fetch }),
        ],
        cardResolver: resolver,
      },
    );

    const factory = new ClientFactory(options);
    const client = await factory.createFromUrl(agentCardUrl, '');

    // Pre-create or explicitly resume the task on the target server.
    // If the a2a-server restarts, its fast in-memory task store may lose the taskId.
    // The google-chat-gateway doesn't store state, so we guarantee the task exists by calling POST /tasks
    // with our stateless sessionId overriding taskId and contextId.
    if (sessionId) {
      try {
        const tasksResponse = await fetch(
          agentCardUrl.replace('/.well-known/agent-card.json', '/tasks'),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taskId: sessionId, contextId: sessionId }),
          },
        );
        if (!tasksResponse.ok) {
          logger.warn(
            `Failed to pre-create or resume task ${sessionId}: ${tasksResponse.statusText}`,
          );
        }
      } catch (err) {
        logger.warn(
          `Network error attempting to pre-create task ${sessionId}:`,
          err,
        );
      }
    }

    const stream = client.sendMessageStream({
      message: {
        kind: 'message',
        role: 'user',
        taskId: sessionId,
        messageId: uuidv4(),
        contextId: sessionId,
        parts: [{ kind: 'text', text: prompt }],
      },
      configuration: { blocking: true },
    });

    let fullResponse = '';

    for await (const chunk of stream) {
      logger.info('Stream Chunk:', JSON.stringify(chunk, null, 2));

      if (chunk.kind === 'status-update') {
        if (chunk.status?.message?.parts) {
          for (const part of chunk.status.message.parts) {
            if (
              part.kind === 'data' &&
              part.data &&
              typeof part.data === 'object'
            ) {
              const data = part.data as Record<string, unknown>;
              let toolName = 'a tool';
              let argsStr = '';

              // 1. Check for standard tool awaiting approval
              if (
                data['status'] === 'awaiting_approval' &&
                data['request'] &&
                data['tool']
              ) {
                const tool = data['tool'] as Record<string, string>;
                const request = data['request'] as Record<string, unknown>;
                toolName = tool['displayName'] || tool['name'] || toolName;
                if (request['args']) {
                  argsStr = JSON.stringify(request['args'], null, 2);
                } else if (request['arguments']) {
                  argsStr = JSON.stringify(request['arguments'], null, 2);
                }
                fullResponse += `\n\n**Action Required:**\nI need your permission to use **${toolName}**.\n\`\`\`\n${argsStr}\n\`\`\`\n\nPlease reply with your approval (e.g., "approve") or rejection.`;
              }
              // 2. Check for ask_user tool executing (which requires user input)
              else if (
                data['status'] === 'executing' &&
                data['request'] &&
                data['tool'] &&
                (data['tool'] as Record<string, string>)['name'] === 'ask_user'
              ) {
                const request = data['request'] as Record<string, unknown>;
                // Determine whether it has 'args' or 'arguments'
                const requestArgs = request['args'] || request['arguments'];
                if (requestArgs) {
                  const args = requestArgs as { questions?: unknown[] };
                  if (args.questions && args.questions.length > 0) {
                    for (const qRaw of args.questions) {
                      const q = qRaw as {
                        type?: string;
                        question?: string;
                        options?: Array<{ label: string; description: string }>;
                      };
                      fullResponse += `\n\n**Question:**\n${q.question}\n`;
                      if (q.type === 'choice' && q.options) {
                        for (let i = 0; i < q.options.length; i++) {
                          const opt = q.options[i];
                          fullResponse += `${i + 1}. **${opt.label}** - ${opt.description}\n`;
                        }
                      } else if (q.type === 'yesno') {
                        fullResponse += `\n*(Please answer yes or no)*\n`;
                      } else {
                        fullResponse += `\n*(Please type your answer)*\n`;
                      }
                    }
                  }
                }
              }
            } else if (part.kind === 'text') {
              fullResponse += part.text;
            }
          }
        }
      }
    }

    return {
      text:
        fullResponse ||
        'Finished processing, but no textual response was given.',
    };
  } catch (error) {
    logger.error('Error communicating with Agent:', error);
    return {
      text: 'Sorry, I encountered an error communicating with the agent server.',
    };
  }
}
