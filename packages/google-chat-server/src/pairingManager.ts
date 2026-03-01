/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { logger } from './logger.js';

export class PairingManager {
  // Map<PairingCode, UserID>
  private pendingodes = new Map<string, string>();

  // Clean up codes after 10 minutes
  private readonly CODE_TTL_MS = 10 * 60 * 1000;

  generateCode(userId: string): string {
    // Generate a simple 6-digit code with a dash: 123-456
    const part1 = Math.floor(100 + Math.random() * 900);
    const part2 = Math.floor(100 + Math.random() * 900);
    const code = `${part1}-${part2}`;

    this.pendingodes.set(code, userId);
    logger.info(`Generated pairing code ${code} for user ${userId}`);

    // Set timeout to expire code
    setTimeout(() => {
      if (this.pendingodes.has(code)) {
        this.pendingodes.delete(code);
        logger.info(`Expired pairing code ${code}`);
      }
    }, this.CODE_TTL_MS);

    return code;
  }

  validateCode(code: string): string | undefined {
    return this.pendingodes.get(code);
  }

  consumeCode(code: string): string | undefined {
    const userId = this.pendingodes.get(code);
    if (userId) {
      this.pendingodes.delete(code);
    }
    return userId;
  }
}

export const pairingManager = new PairingManager();
