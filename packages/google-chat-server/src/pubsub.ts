/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { PubSub } from '@google-cloud/pubsub';
import { logger } from './logger.js';

const pubsub = new PubSub();
const INGRESS_TOPIC = 'chat-ingress';
const EGRESS_TOPIC = 'chat-egress';

export async function publishToIngress(
  userEmail: string,
  payload: Record<string, unknown>,
) {
  const dataBuffer = Buffer.from(JSON.stringify(payload));
  const messageId = await pubsub.topic(INGRESS_TOPIC).publishMessage({
    data: dataBuffer,
    attributes: {
      target_user_email: userEmail,
    },
  });
  logger.info(`Message ${messageId} published to user ${userEmail}`);
}

export async function provisionUserPubSub(userEmail: string) {
  const safeEmail = userEmail.replace(/[^a-zA-Z0-9]/g, '-');
  const subName = `chat-ingress-sub-${safeEmail}`;

  try {
    const topic = pubsub.topic(INGRESS_TOPIC);
    const subscription = pubsub.subscription(subName);

    const [exists] = await subscription.exists();
    if (!exists) {
      await topic.createSubscription(subName, {
        filter: `attributes.target_user_email = "${userEmail}"`,
        enableMessageOrdering: true,
      });
      logger.info(`Created subscription ${subName}`);
    }

    // Grant subscriber role to the specific user on the subscription
    const [subPolicy] = await subscription.iam.getPolicy();
    subPolicy.bindings = subPolicy.bindings || [];
    let subRoleBinding = subPolicy.bindings.find(
      (b) => b.role === 'roles/pubsub.subscriber',
    );
    if (!subRoleBinding) {
      subRoleBinding = { role: 'roles/pubsub.subscriber', members: [] };
      subPolicy.bindings.push(subRoleBinding);
    }
    const member = `user:${userEmail}`;
    if (!subRoleBinding.members) subRoleBinding.members = [];
    if (!subRoleBinding.members.includes(member)) {
      subRoleBinding.members.push(member);
      await subscription.iam.setPolicy(subPolicy);
      logger.info(`Granted subscriber to ${member} on ${subName}`);
    }

    // Grant publisher role to the user on the egress topic
    const egressTopic = pubsub.topic(EGRESS_TOPIC);
    const [egressPolicy] = await egressTopic.iam.getPolicy();
    egressPolicy.bindings = egressPolicy.bindings || [];
    let pubRoleBinding = egressPolicy.bindings.find(
      (b) => b.role === 'roles/pubsub.publisher',
    );
    if (!pubRoleBinding) {
      pubRoleBinding = { role: 'roles/pubsub.publisher', members: [] };
      egressPolicy.bindings.push(pubRoleBinding);
    }
    if (!pubRoleBinding.members) pubRoleBinding.members = [];
    if (!pubRoleBinding.members.includes(member)) {
      pubRoleBinding.members.push(member);
      await egressTopic.iam.setPolicy(egressPolicy);
      logger.info(`Granted publisher to ${member} on ${EGRESS_TOPIC}`);
    }
  } catch (error) {
    logger.error('Failed to provision Pub/Sub resources', error);
    throw error;
  }
}
