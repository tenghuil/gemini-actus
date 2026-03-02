/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import { GoogleAuth } from 'google-auth-library';
import { v4 as uuidv4 } from 'uuid';
import { checkUserPaired, setUserPaired } from './firestore.js';
import { publishToIngress, provisionUserPubSub } from './pubsub.js';
import { logger } from './logger.js';
import type {
  ChatEvent,
  AgentRequestPacket,
  AgentResponsePacket,
} from './types.js';

const app = express();
app.use(express.json());

// Helper to extract text and ids
function parseChatEvent(event: ChatEvent) {
  let text = '';
  let email = '';
  let spaceName = '';
  let threadName = '';

  // New Google Chat API structure
  if (event.chat && event.chat.messagePayload) {
    const mp = event.chat.messagePayload;
    if (mp.message) {
      text = mp.message.argumentText || mp.message.text || '';
      spaceName = mp.message.space?.name || mp.space?.name || '';
      threadName = mp.message.thread?.name || '';
      email = mp.message.sender?.email || '';
    }
  }
  // Legacy or simplified structure
  else if (event.message) {
    text = event.message.text || '';
    spaceName = event.space?.name || '';
    threadName = event.message.thread?.name || '';
    email = event.message.sender?.email || event.user?.email || '';
  }

  return { text, email, spaceName, threadName };
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

// 1. Webhook Endpoint: Receives messages from Google Chat
app.post('/webhook', async (req, res) => {
  const event = req.body as ChatEvent;
  logger.info('Received webhook event', { type: event.type });

  const { text, email, spaceName, threadName } = parseChatEvent(event);

  if (!email) {
    logger.warn('Could not determine user email from event');
    res.status(400).send('Invalid event: missing user email');
    return;
  }

  // Handle Regular Message
  if (event.type === 'MESSAGE' || (event.chat && event.type === undefined)) {
    const isPaired = await checkUserPaired(email);

    if (isPaired) {
      // Forward to Agent via Pub/Sub
      const requestId = uuidv4();
      const packet: AgentRequestPacket = {
        kind: 'agent-request',
        id: requestId,
        prompt: text,
        spaceName,
        threadName,
      };

      await publishToIngress(
        email,
        packet as unknown as Record<string, unknown>,
      );
      res.json({}); // Acknowledge receipt, agent will reply async
      return;
    }

    if (spaceName) {
      const fallbackText = `Agent not connected. Please run \`gemini-actus connect-chat\` and follow the instructions to pair your agent.`;
      await sendAsyncReply(spaceName, threadName, fallbackText);
      res.json({});
      return;
    } else {
      res.json({
        text: `Agent not connected. Please run \`gemini-actus connect-chat\` and follow the instructions to pair your agent.`,
      });
      return;
    }
  }

  res.json({});
});

// 2. Register Endpoint: Called by CLI to provision PubSub resources
app.post('/register', async (req, res) => {
  try {
    logger.info(`Register headers received: ${JSON.stringify(req.headers)}`);
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      res.status(401).send('Missing or invalid Authorization header');
      return;
    }

    const idToken = authHeader.split(' ')[1];

    // Decode the ID token payload directly (since it's over HTTPS and from a trusted developer's CLI)
    // We just need the email from the payload.
    const payloadBase64 = idToken.split('.')[1];
    if (!payloadBase64) {
      res.status(400).send('Invalid token format');
      return;
    }
    const decodedPayload = Buffer.from(payloadBase64, 'base64').toString(
      'utf8',
    );
    const payload = JSON.parse(decodedPayload);
    const email = payload.email || '';

    if (!email) {
      res.status(403).send('No email associated with token');
      return;
    }

    await provisionUserPubSub(email);
    await setUserPaired(email);

    res.status(200).json({ status: 'paired', email });
  } catch (err) {
    logger.error('Failed to register user', err);
    res.status(500).send('Internal Server Error');
  }
});

// 3. Egress Endpoint: Triggered by Pub/Sub Push subscriptions to send agent replies to Chat
app.post('/egress', async (req, res) => {
  try {
    if (!req.body || !req.body.message) {
      res.status(400).send('Bad Request: Missing Pub/Sub message');
      return;
    }

    const decodedData = Buffer.from(req.body.message.data, 'base64').toString(
      'utf8',
    );
    const packet = JSON.parse(decodedData) as AgentResponsePacket;

    if (packet.kind === 'agent-response' && packet.spaceName) {
      let replyText = packet.text || '';
      if (packet.error) {
        replyText = `Agent encountered an error: ${packet.error}`;
      }
      await sendAsyncReply(
        packet.spaceName,
        packet.threadName || '',
        replyText,
      );
    }

    // Acknowledge the message
    res.status(200).send();
  } catch (err) {
    logger.error('Failed to process egress event', err);
    res.status(500).send('Internal Server Error');
  }
});

const port = process.env['PORT'] || 8080;
app.listen(port, () => {
  logger.info(`Google Chat Server listening on port ${port}`);
});
