/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import dotenv from 'dotenv';
import path from 'node:path';
import { logger } from './logger.js';
import { GatewayClient } from './client.js';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const args = process.argv.slice(2);
let projectId = '';
let email = '';
let serverUrl =
  process.env['GOOGLE_CHAT_SERVER_URL'] || 'http://localhost:8080';

// Simple arg parsing logic
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--server' && args[i + 1]) {
    serverUrl = args[i + 1];
    i++;
  } else if (args[i] === '--project' && args[i + 1]) {
    projectId = args[i + 1];
    i++;
  } else if (!args[i].startsWith('-') && !email) {
    email = args[i];
  }
}

if (!email || !projectId) {
  logger.error('Please provide an email and project.');
  logger.info(
    'Usage: npm start -- <email> --project <project-id> --server <server-url>',
  );
  process.exit(1);
}

logger.info(`Starting Gemini Actus Chat Gateway...`);
logger.info(`Server: ${serverUrl}`);
logger.info(`Project ID: ${projectId}`);
logger.info(`Email: ${email}`);

const client = new GatewayClient(serverUrl, projectId);
void client.connect(email);

// Keep process alive
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  process.exit(0);
});
