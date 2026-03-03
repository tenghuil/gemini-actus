/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { askAgent } from './agentClient.js';
import { sendAsyncMessage } from './chatApi.js';
import { logger } from './logger.js';

interface ChatEvent {
  chat?: {
    messagePayload?: {
      message?: {
        argumentText?: string;
        text?: string;
        thread?: { name?: string };
      };
      space?: { name?: string; spaceType?: string; type?: string };
    };
  };
  type?: string;
  message?: {
    text?: string;
    thread?: { name?: string };
  };
  space?: { name?: string; spaceType?: string; type?: string };
}

/**
 * Handle incoming Google Chat events (both HTTP webhook and Pub/Sub).
 */
export async function handleChatEvent(
  event: ChatEvent,
): Promise<{ text?: string } | void> {
  // Handler for the new Google Chat API interaction structure
  if (event.chat && event.chat.messagePayload) {
    const messagePayload = event.chat.messagePayload;
    if (messagePayload.message) {
      const text =
        messagePayload.message.argumentText ||
        messagePayload.message.text ||
        '';
      const spaceName = messagePayload.space?.name;
      const spaceType =
        messagePayload.space?.type || messagePayload.space?.spaceType;
      const threadName = messagePayload.message.thread?.name;
      const threadKey = (
        messagePayload.message.thread as { threadKey?: string }
      )?.threadKey;

      if (text && spaceName) {
        // Extract spaceId and threadId
        const spaceId = spaceName.replace(/^spaces\//, '');
        const threadId = threadName
          ? threadName
              .replace(/^spaces\/[^/]+\/threads\//, '')
              .replace(/^threads\//, '')
          : threadKey;

        let sessionId = spaceId;
        // The API sends threadName for DMs sometimes but we shouldn't consider it a threaded session.
        if (spaceType !== 'DIRECT_MESSAGE' && threadId) {
          sessionId = `${spaceId}_${threadId}`;
        }

        // Send the prompt to the core agent and then reply asynchronously
        askAgent(text, sessionId)
          .then((agentResponse) => {
            if (agentResponse.text) {
              return sendAsyncMessage(
                spaceName,
                spaceType === 'DIRECT_MESSAGE' ? undefined : threadName,
                spaceType === 'DIRECT_MESSAGE' ? undefined : threadKey,
                agentResponse.text,
              );
            }
            return Promise.resolve();
          })
          .catch((err) => {
            logger.error('Background agent processing error:', err);
          });
      }
      return;
    }
  }

  // Fallback for legacy event format
  if (event.type === 'ADDED_TO_SPACE') {
    return {
      text: 'Hello! I am the Gemini Actus gateway bot. Thanks for adding me!',
    };
  }

  if (event.type === 'MESSAGE' && event.message) {
    const text = event.message.text || '';
    const spaceName = event.space?.name;
    const spaceType = event.space?.type || event.space?.spaceType; // Pub/sub might omit spaceType but provide type
    const threadName = event.message.thread?.name;
    const threadKey = (event.message.thread as { threadKey?: string })
      ?.threadKey;

    if (text && spaceName) {
      // Extract spaceId and threadId
      const spaceId = spaceName.replace(/^spaces\//, '');
      const threadId = threadName
        ? threadName
            .replace(/^spaces\/[^/]+\/threads\//, '')
            .replace(/^threads\//, '')
        : threadKey;

      let sessionId = spaceId;
      // The API sends threadName for DMs sometimes but we shouldn't consider it a threaded session.
      if (spaceType !== 'DIRECT_MESSAGE' && threadId) {
        sessionId = `${spaceId}_${threadId}`;
      }

      // Send the prompt to the core agent and then reply asynchronously
      askAgent(text, sessionId)
        .then((agentResponse) => {
          if (agentResponse.text) {
            return sendAsyncMessage(
              spaceName,
              spaceType === 'DIRECT_MESSAGE' ? undefined : threadName,
              spaceType === 'DIRECT_MESSAGE' ? undefined : threadKey,
              agentResponse.text,
            );
          }
          return Promise.resolve();
        })
        .catch((err) => {
          logger.error('Background agent processing error:', err);
        });
    }
    return;
  }
  return;
}
