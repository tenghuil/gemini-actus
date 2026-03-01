/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { GoogleAuth } from 'google-auth-library';
import { logger } from './logger.js';
import type { ChatEvent, AgentRequestPacket } from './types.js';
import { pairingManager } from './pairingManager.js';
import { connectionRegistry } from './connectionRegistry.js';
import { v4 as uuidv4 } from 'uuid';

export const app = express();
app.use(express.json());

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Helper to extract text and ids
function parseChatEvent(event: ChatEvent) {
  let text = '';
  let userId = '';
  let spaceName = '';
  let threadName = '';

  // New Google Chat API structure
  if (event.chat && event.chat.messagePayload) {
    const mp = event.chat.messagePayload;
    if (mp.message) {
      text = mp.message.argumentText || mp.message.text || '';
      spaceName = mp.message.space?.name || mp.space?.name || '';
      threadName = mp.message.thread?.name || '';
      userId = mp.message.sender?.name || '';
    }
  }
  // Legacy or simplified structure
  else if (event.message) {
    text = event.message.text || '';
    spaceName = event.space?.name || '';
    threadName = event.message.thread?.name || '';
    userId = event.message.sender?.name || event.user?.name || '';
  }

  return { text, userId, spaceName, threadName };
}

async function sendAsyncReply(
  spaceName: string,
  threadName: string,
  text: string,
) {
  try {
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/chat.bot'],
    });
    const client = await auth.getClient();
    const url = `https://chat.googleapis.com/v1/${spaceName}/messages`;

    const body: Record<string, unknown> = { text };
    if (threadName) {
      body['thread'] = { name: threadName };
    }

    logger.info(`Sending async reply to ${url}`, { body });
    await client.request({
      url,
      method: 'POST',
      data: body,
    });
    logger.info('Async reply sent successfully');
  } catch (error) {
    logger.error('Failed to send async reply', error);
  }
}

app.post('/webhook', async (req, res) => {
  const event = req.body as ChatEvent;
  logger.info('Received webhook event', { type: event.type });
  logger.info('Full event body:', JSON.stringify(event));

  // Handle Slash Command /pair
  const { text, userId, spaceName, threadName } = parseChatEvent(event);

  if (!userId) {
    logger.warn('Could not determine userId from event');
    res.status(400).send('Invalid event: missing user');
    return;
  }

  if (text.trim().startsWith('/pair')) {
    const code = pairingManager.generateCode(userId);
    const replyText = `To pair with your local agent, run this command in your terminal:\n\n\`gemini-actus connect-chat ${code}\``;

    // Send async reply
    if (spaceName) {
      await sendAsyncReply(spaceName, threadName, replyText);
    } else {
      logger.error('Cannot send async reply: spaceName is missing');
    }

    // Return empty acknowledgement to the webhook
    res.status(200).json({});
    return;
  }

  // Handle Regular Message
  if (event.type === 'MESSAGE' || (event.chat && event.type === undefined)) {
    // Check connection first
    const connection = connectionRegistry.getConnection(userId);
    if (connection) {
      // Forward to Agent
      const requestId = uuidv4();
      const packet: AgentRequestPacket = {
        kind: 'agent-request',
        id: requestId,
        prompt: text,
        spaceName,
        threadName,
      };

      const sent = connectionRegistry.sendToUser(userId, packet);
      if (sent) {
        // Acknowledge receipt, agent will reply async
        res.json({});
        return;
      }
    }

    // Fallback: Use Async Reply for this too?
    // Current logic uses sync reply for fallback. Let's switch to async for consistency if spaceName exists.
    if (spaceName) {
      const fallbackText = `Agent not connected. Please run \`/pair\` to get a connection code, then connect your local agent.`;
      await sendAsyncReply(spaceName, threadName, fallbackText);
      res.json({});
      return;
    } else {
      res.json({
        text: `Agent not connected. Please run \`/pair\` to get a connection code, then connect your local agent.`,
      });
      return;
    }
  }

  // Default handler
  res.json({});
});
