/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';

export const sessionId = process.env['GEMINI_SESSION_ID'] || randomUUID();
process.env['GEMINI_SESSION_ID'] = sessionId;
