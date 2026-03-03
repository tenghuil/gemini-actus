/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { connectChatCommand } from './src/commands/connectChat.js';

yargs(hideBin(process.argv))
  .command(connectChatCommand)
  .demandCommand(1, 'You need to specify a command')
  .help()
  .parse();
