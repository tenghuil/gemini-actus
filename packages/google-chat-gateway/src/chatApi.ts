/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { auth as googleAuth, chat_v1 } from '@googleapis/chat';
import { logger } from './logger.js';

export async function sendAsyncMessage(
  spaceName: string,
  threadName: string,
  text: string,
): Promise<void> {
  try {
    // Uses Google Application Default Credentials from the environment.
    // Explicitly using GoogleAuth to verify credentials
    // We start by getting the source credentials (which should be the user's ADC)
    const auth = new googleAuth.GoogleAuth({
      // We do NOT ask for chat.bot scope here for the user credential,
      // as the user credential itself might not be allowed to have it directly if it's not a service account.
      // Instead, we need the 'https://www.googleapis.com/auth/cloud-platform' scope to be able to impersonate.
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      projectId:
        process.env['GOOGLE_CLOUD_PROJECT'] ||
        process.env['GOOGLE_CLOUD_PROJECT_NUMBER'],
      // @ts-expect-error universeDomain is not yet in the types for this version
      universeDomain: 'googleapis.com',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let authClient: any = await auth.getClient();
    // Force set universeDomain if it's missing, to satisfy Impersonated credentials check
    if (!('universeDomain' in authClient)) {
      (authClient as unknown as { universeDomain: string }).universeDomain =
        'googleapis.com';
    }

    // Check if we need to impersonate a service account
    const saEmail = process.env['GOOGLE_CHAT_SA_EMAIL'];
    if (saEmail) {
      logger.info(`Impersonating Service Account: ${saEmail}`);
      const { Impersonated } = await import('google-auth-library');
      authClient = new Impersonated({
        sourceClient: authClient,
        targetPrincipal: saEmail,
        lifetime: 3600,
        delegates: [],
        targetScopes: ['https://www.googleapis.com/auth/chat.bot'],
        universeDomain: 'googleapis.com',
      });
    } else {
      logger.warn(
        'GOOGLE_CHAT_SA_EMAIL not set. Attempting to use credentials directly.',
      );
    }

    const chat = new chat_v1.Chat({
      auth: authClient,
    });

    await chat.spaces.messages.create({
      parent: spaceName,
      requestBody: {
        text,
        thread: {
          name: threadName,
        },
      },
    });

    logger.info(`Successfully sent asynchronous message to ${threadName}`);
  } catch (error) {
    logger.error('Error sending message to Google Chat:', error);
    // Log the error stack to see if it's strictly credential parsing
  }
}
