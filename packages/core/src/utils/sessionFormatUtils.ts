/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Content, Part } from '@google/genai';
import type { ConversationRecord } from '../services/chatRecordingService.js';
import { partToString } from './partUtils.js';

/**
 * Converts stored conversation records into the @google/genai Content format
 * needed by the Gemini client to resume a chat session.
 * This filters out system messages, slash commands, etc.
 */
export function getResumeHistoryFromRecord(
  messages: ConversationRecord['messages'],
): Content[] {
  const clientHistory: Content[] = [];

  for (const msg of messages) {
    // Skip system/error messages
    if (msg.type === 'info' || msg.type === 'error' || msg.type === 'warning') {
      continue;
    }

    if (msg.type === 'user') {
      const contentString = partToString(msg.content);
      // Skip user slash commands
      if (
        contentString.trim().startsWith('/') ||
        contentString.trim().startsWith('?')
      ) {
        continue;
      }

      // Add regular user message
      clientHistory.push({
        role: 'user',
        parts: [{ text: contentString }],
      });
    } else if (msg.type === 'gemini') {
      // Handle Gemini messages with potential tool calls
      const hasToolCalls = msg.toolCalls && msg.toolCalls.length > 0;

      if (hasToolCalls) {
        // Create model message with function calls
        const modelParts: Part[] = [];

        // Add text content if present
        const contentString = partToString(msg.content);
        if (msg.content && contentString.trim()) {
          modelParts.push({ text: contentString });
        }

        // Add function calls
        for (const toolCall of msg.toolCalls!) {
          modelParts.push({
            functionCall: {
              name: toolCall.name,
              args: toolCall.args,
              ...(toolCall.id && { id: toolCall.id }),
            },
          });
        }

        clientHistory.push({
          role: 'model',
          parts: modelParts,
        });

        // Create single function response message with all tool call responses
        const functionResponseParts: Part[] = [];
        for (const toolCall of msg.toolCalls!) {
          if (toolCall.result) {
            // Convert PartListUnion result to function response format
            let responseData: Part;

            if (typeof toolCall.result === 'string') {
              responseData = {
                functionResponse: {
                  id: toolCall.id,
                  name: toolCall.name,
                  response: {
                    output: toolCall.result,
                  },
                },
              };
            } else if (Array.isArray(toolCall.result)) {
              // toolCall.result is an array containing properly formatted
              // function responses
              functionResponseParts.push(...(toolCall.result as Part[]));
              continue;
            } else {
              // Fallback for non-array results
              responseData = toolCall.result;
            }

            functionResponseParts.push(responseData);
          }
        }

        // Only add user message if we have function responses
        if (functionResponseParts.length > 0) {
          clientHistory.push({
            role: 'user',
            parts: functionResponseParts,
          });
        }
      } else {
        // Regular Gemini message without tool calls
        const contentString = partToString(msg.content);
        if (msg.content && contentString.trim()) {
          clientHistory.push({
            role: 'model',
            parts: [{ text: contentString }],
          });
        }
      }
    }
  }

  return clientHistory;
}
