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
let pairingCode = '';
let serverUrl = process.env['GOOGLE_CHAT_SERVER_URL'] || 'ws://localhost:8080';

// Simple arg parsing logic
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--server' && args[i + 1]) {
    serverUrl = args[i + 1];
    i++;
  } else if (!args[i].startsWith('-') && !pairingCode) {
    pairingCode = args[i];
  }
}

if (!pairingCode) {
  logger.error('Please provide a pairing code.');
  logger.info('Usage: gemini-actus connect-chat <pairing-code>');
  process.exit(1);
}

logger.info(`Starting Gemini Actus Chat Gateway...`);
logger.info(`Server: ${serverUrl}`);
logger.info(`Pairing Code: ${pairingCode}`);

const client = new GatewayClient(serverUrl, pairingCode);
client.connect();

// Keep process alive
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  process.exit(0);
});
