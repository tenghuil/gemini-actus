/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env['LOG_LEVEL'] || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.prettyPrint(),
  ),
  transports: [new winston.transports.Console()],
});
