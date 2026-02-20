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
    // Check if we need to impersonate a service account
    const saEmail = process.env['GOOGLE_CHAT_SA_EMAIL'];

    // We need 'https://www.googleapis.com/auth/cloud-platform' to be able to impersonate.
    // If we are NOT impersonating (saEmail is undefined), we need 'chat.messages' and 'chat.spaces' to act as a user.
    const scopes = ['https://www.googleapis.com/auth/cloud-platform'];
    if (!saEmail) {
      scopes.push('https://www.googleapis.com/auth/chat.messages');
      scopes.push('https://www.googleapis.com/auth/chat.spaces');
    }

    // Uses Google Application Default Credentials from the environment.
    // Explicitly using GoogleAuth to verify credentials
    // We start by getting the source credentials (which should be the user's ADC)
    const auth = new googleAuth.GoogleAuth({
      scopes,
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
        'GOOGLE_CHAT_SA_EMAIL not set. Using credentials directly with chat.messages and chat.spaces scopes.',
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
