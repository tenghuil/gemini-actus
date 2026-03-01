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
  { code: string; server: string }
> = {
  command: 'connect-chat <code>',
  describe: 'Connect to Google Chat via a pairing code',
  builder: (yargs) =>
    yargs
      .positional('code', {
        describe: 'The pairing code provided by the Google Chat bot',
        type: 'string',
        demandOption: true,
      })
      .option('server', {
        describe: 'The URL of the Google Chat Server',
        type: 'string',
        default: 'https://gemini-chat-server-731580970632.us-central1.run.app',
      }),
  handler: async (argv) => {
    const serverUrl = argv.server.replace('http', 'ws'); // Ensure WebSocket protocol
    const targetAudience = argv.server.replace('ws', 'http'); // Audience must be http(s)

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
        // For user accounts, we cannot use --audiences. Cloud Run often accepts the default token.
        const cmd = `gcloud auth print-identity-token`;
        token = execSync(cmd, { encoding: 'utf-8' }).trim();
        debugLogger.log('Successfully fetched ID token via gcloud fallback');
      } catch (gcloudError) {
        debugLogger.warn(
          'Failed to fetch ID token via gcloud fallback as well. Proceeding without auth.',
          gcloudError,
        );
      }
    }

    debugLogger.log(`Using Target Audience: ${targetAudience}`);
    if (token) {
      debugLogger.log(
        `Token provided (first 10 chars): ${token.substring(0, 10)}...`,
      );
    } else {
      debugLogger.warn('No token provided!');
    }

    // Start the Agent Server (A2A)
    try {
      debugLogger.log('Starting local Agent Server...');
      // Dynamic import to avoid build-time issues if dependency is tricky
      const { createApp, updateCoderAgentCardUrl } = await import(
        '@google/gemini-actus-a2a-server'
      );
      const app = await createApp();
      // Use a random port or default
      const agentPort = 41242;
      app.listen(agentPort, 'localhost', () => {
        debugLogger.log(`Agent Server running on port ${agentPort}`);
        updateCoderAgentCardUrl(agentPort);
      });
      process.env['CODER_AGENT_PORT'] = agentPort.toString();
    } catch (serverError) {
      debugLogger.error('Failed to start local Agent Server:', serverError);
      // We explicitly fail here because without the agent, the chat is useless
      // eslint-disable-next-line no-console
      console.error(
        'Error: Could not start local agent server. Is it already running?',
      );
      return;
    }

    debugLogger.log(`Connecting to ${serverUrl} with code ${argv.code}`);

    // We need to keep the process alive
    const client = new GatewayClient(serverUrl, argv.code, token);
    client.connect();

    // Prevent process exit
    await new Promise(() => {});
  },
};
