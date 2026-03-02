/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import { GatewayClient } from '@google/gemini-actus-google-chat-gateway/client';
import { debugLogger } from '@google/gemini-actus-core';
import { GoogleAuth } from 'google-auth-library';
import { execSync } from 'node:child_process';

export const connectChatCommand: CommandModule<
  unknown,
  { server: string; project: string }
> = {
  command: 'connect-chat',
  describe: 'Connect to Google Chat Bot via Cloud Functions',
  builder: (yargs) =>
    yargs
      .option('server', {
        describe:
          'The URL of the Google Chat Cloud Function (register endpoint)',
        type: 'string',
        demandOption: true,
      })
      .option('project', {
        describe: 'The Developer GCP Project ID',
        type: 'string',
        demandOption: true,
      }),
  handler: async (argv) => {
    const serverUrl = argv.server;
    const targetAudience = argv.server; // Target Audience for the ID Token

    let token: string | undefined;
    try {
      const auth = new GoogleAuth();
      const client = await auth.getIdTokenClient(targetAudience);
      const headers = (await client.getRequestHeaders()) as unknown as Record<
        string,
        string
      >;
      // Handle case-insensitive headers
      const authHeader =
        headers['Authorization'] ||
        headers['authorization'] ||
        headers['AUTHORIZATION'];

      if (authHeader) {
        token = authHeader.split(' ')[1];
      }

      if (!token) {
        throw new Error('Failed to extract token from headers');
      }
      debugLogger.log('Successfully fetched ID token for authentication');
    } catch (e) {
      debugLogger.warn(
        'Failed to fetch ID token via library, trying gcloud fallback...',
        e,
      );
      try {
        const cmd = `gcloud auth print-identity-token`;
        token = execSync(cmd, { encoding: 'utf-8' }).trim();
        debugLogger.log('Successfully fetched ID token via gcloud fallback');
      } catch (gcloudError) {
        debugLogger.error(
          'Failed to fetch ID token via gcloud fallback.',
          gcloudError,
        );
        // eslint-disable-next-line no-console
        console.error(
          'Authentication failed. Please run `gcloud auth login` and ensure you can generate an identity token.',
        );
        process.exit(1);
      }
    }

    if (!token) {
      debugLogger.error('No token provided!');
      process.exit(1);
    }

    // Call the Registration endpoint
    debugLogger.log(`Registering with server: ${serverUrl}`);
    debugLogger.log(
      `Sending token (first 10 chars): ${token.substring(0, 10)}...`,
    );
    let email = '';
    try {
      const res = await fetch(serverUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server returned ${res.status}: ${errText}`);
      }
      const data = (await res.json()) as { email: string; status: string };
      email = data.email;
      debugLogger.log(
        `Successfully registered as ${email}. Status: ${data.status}`,
      );
      // eslint-disable-next-line no-console
      console.log(`Paired with Google Chat Bot as ${email}`);
    } catch (regError) {
      debugLogger.error('Registration failed:', regError);
      // eslint-disable-next-line no-console
      console.error('Failed to pair with the server. Are you authorized?');
      process.exit(1);
    }

    // Start the Agent Server (A2A)
    try {
      debugLogger.log('Starting local Agent Server...');
      const { createApp, updateCoderAgentCardUrl } = await import(
        '@google/gemini-actus-a2a-server'
      );
      const app = await createApp();
      const agentPort = 41242;
      app.listen(agentPort, 'localhost', () => {
        debugLogger.log(`Agent Server running on port ${agentPort}`);
        updateCoderAgentCardUrl(agentPort);
      });
      process.env['CODER_AGENT_PORT'] = agentPort.toString();
    } catch (serverError) {
      debugLogger.error('Failed to start local Agent Server:', serverError);
      // eslint-disable-next-line no-console
      console.error(
        'Error: Could not start local agent server. Is it already running?',
      );
      return;
    }

    debugLogger.log(
      `Starting Pub/Sub Gateway Client for project ${argv.project}`,
    );
    const client = new GatewayClient(serverUrl, argv.project);
    void client.connect(email);

    // Prevent process exit
    await new Promise(() => {});
  },
};
