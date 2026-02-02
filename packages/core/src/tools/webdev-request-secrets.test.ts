/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebdevRequestSecretsTool } from './webdev-request-secrets.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

vi.mock('node:crypto', () => ({
  randomUUID: () => 'test-uuid',
}));

describe('WebdevRequestSecretsTool', () => {
  let tempDir: string;
  let tool: WebdevRequestSecretsTool;
  let mockMessageBus: MessageBus;

  beforeEach(() => {
    mockMessageBus = {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
      publish: vi.fn().mockResolvedValue(undefined),
    } as unknown as MessageBus;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-secrets-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
    tool = new WebdevRequestSecretsTool(mockMessageBus);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('should be instantiable', () => {
    expect(tool).toBeDefined();
    expect(tool.name).toBe('webdev_request_secrets');
  });

  it('should request secrets via MessageBus and save to .env', async () => {
    // Mock MessageBus flow
    let responseHandler: ((response: unknown) => void) | undefined;
    const subscribeMock = mockMessageBus.subscribe as unknown as {
      mockImplementation: (
        fn: (type: unknown, handler: unknown) => void,
      ) => void;
    };
    subscribeMock.mockImplementation((type: unknown, handler: unknown) => {
      if (type === 'ask-user-response') {
        responseHandler = handler as (response: unknown) => void;
      }
    });

    const invocation = tool.build({
      message: 'Need DB creds',
      secrets: [
        { name: 'DB_USER', description: 'User' },
        { name: 'DB_PASS', description: 'Pass' },
      ],
    });

    const executePromise = invocation.execute(new AbortController().signal);

    // Simulate response after a short delay to allow subscription
    setTimeout(() => {
      if (responseHandler) {
        responseHandler({
          type: 'ask-user-response',
          correlationId: 'test-uuid',
          answers: {
            '0': 'user123',
            '1': 'pass456',
          },
        });
      }
    }, 10);

    const result = await executePromise;

    // Check .env content
    const envPath = path.join(tempDir, '.env');
    expect(fs.existsSync(envPath)).toBe(true);
    const content = fs.readFileSync(envPath, 'utf-8');
    expect(content).toContain('DB_USER=user123');
    expect(content).toContain('DB_PASS=pass456');

    expect(result.llmContent).toContain('Successfully acquired');
  });
});
