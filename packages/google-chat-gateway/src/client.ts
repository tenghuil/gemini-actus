/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PubSub } from '@google-cloud/pubsub';
import type { Message } from '@google-cloud/pubsub';
import { logger } from './logger.js';
import { askAgent } from './agentClient.js';
import type { AgentRequestPacket, AgentResponsePacket } from './types.js';

export class GatewayClient {
  private pubsub: PubSub;

  constructor(serverUrl: string, projectId: string) {
    this.pubsub = new PubSub({ projectId });
  }

  async connect(email: string) {
    const safeEmail = email.replace(/[^a-zA-Z0-9]/g, '-');
    const subName = `chat-ingress-sub-${safeEmail}`;

    logger.info(
      `Starting Gateway Client. Listening on subscription: ${subName}`,
    );

    const subscription = this.pubsub.subscription(subName);

    subscription.on('message', async (message: Message) => {
      try {
        const dataStr = message.data.toString('utf8');
        const packet = JSON.parse(dataStr) as AgentRequestPacket;

        if (packet.kind === 'agent-request') {
          logger.info(`Received prompt: ${packet.prompt}`);

          // Acknowledge the message so it's not redelivered
          message.ack();

          // Execute Agent Logic
          const response = await askAgent(packet.prompt);

          // Send Response back via egress topic
          const reply: AgentResponsePacket = {
            kind: 'agent-response',
            id: packet.id,
            text: response.text,
            spaceName: packet.spaceName,
            threadName: packet.threadName,
          };

          const egressTopic = this.pubsub.topic('chat-egress');
          await egressTopic.publishMessage({
            data: Buffer.from(JSON.stringify(reply)),
          });
          logger.info('Reply sent to egress topic.');
        } else {
          message.ack();
        }
      } catch (e) {
        logger.error('Error handling message from server', e);
        // Nack to retry if processing fails completely
        message.nack();
      }
    });

    subscription.on('error', (error) => {
      logger.error('Received error from subscription:', error);
    });
  }
}
