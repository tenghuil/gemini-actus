/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import { verifyGoogleChatWebhook } from './auth.js';
import { handleChatEvent } from './eventHandler.js';
import { logger } from './logger.js';
import { sendAsyncMessage } from './chatApi.js';

const router = Router();

// To be secure, this should use verifyGoogleChatWebhook in production.
// During development, you might skip it if needed.
const authMiddleware =
  process.env['NODE_ENV'] === 'development'
    ? (req: Request, res: Response, next: NextFunction) => next()
    : verifyGoogleChatWebhook;

router.post('/internal/push', async (req, res) => {
  const { sessionId, text } = req.body;
  if (!sessionId || !text) {
    res.status(400).send({ error: 'Missing sessionId or text' });
    return;
  }
  
  try {
    const spaceId = sessionId.split('::')[0];
    const threadId = sessionId.split('::')[1];
    const spaceName = `spaces/${spaceId}`;
    let threadName = undefined;
    if (threadId) {
      threadName = `spaces/${spaceId}/threads/${threadId}`;
    }
    
    await sendAsyncMessage(spaceName, threadName, undefined, text);
    res.status(200).send({ success: true });
  } catch (err) {
    logger.error('Error in internal push:', err);
    res.status(500).send({ error: 'Failed to send message' });
  }
});

router.post('/webhook', authMiddleware, async (req, res) => {
  const event = req.body;
  logger.info(`Content-Type: ${req.header('content-type')}`);
  logger.info(`Full Request Body: ${JSON.stringify(event)}`);
  logger.info(`Received webhook event type: ${event.type}`);

  try {
    const syncResponse = await handleChatEvent(event);

    // Acknowledge synchronously to avoid 30s timeout
    if (syncResponse) {
      res.status(200).send(syncResponse);
    } else {
      res.status(200).send({});
    }
  } catch (err) {
    logger.error('Error handling chat event in webhook:', err);
    res.status(500).send();
  }
});

export { router as googleChatRoutes };
