/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  SubagentRegistry,
  type SubagentRunRecord,
} from './subagent-registry.js';
import { Storage } from '../config/storage.js';

vi.mock('node:fs');
vi.mock('../config/storage.js');

describe('SubagentRegistry', () => {
  let registry: SubagentRegistry;
  const mockDir = '/tmp/mock-subagents';
  const mockFile = path.join(mockDir, 'registry.json');

  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Storage, 'getSubagentsDir').mockReturnValue(mockDir);
    registry = new SubagentRegistry();
  });

  afterEach(() => {
    registry.stopSweeper();
  });

  it('should load runs from disk', async () => {
    const mockData: Record<string, SubagentRunRecord> = {
      'run-1': {
        runId: 'run-1',
        childSessionKey: 'session-1',
        requesterSessionKey: 'main',
        requesterDisplayKey: 'Main',
        task: 'task-1',
        cleanup: 'keep',
        createdAt: 1000,
      },
    };
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify(mockData));

    await registry.load();

    expect(registry.getRun('run-1')).toEqual(mockData['run-1']);
  });

  it('should save runs to disk', async () => {
    const mockRun: SubagentRunRecord = {
      runId: 'run-1',
      childSessionKey: 'session-1',
      requesterSessionKey: 'main',
      requesterDisplayKey: 'Main',
      task: 'test task',
      cleanup: 'delete',
      createdAt: 2000,
    };

    vi.spyOn(fs, 'existsSync').mockReturnValue(false); // Dir doesn't exist
    vi.spyOn(fs, 'mkdirSync');
    vi.spyOn(fs, 'writeFileSync');

    await registry.registerRun(mockRun);

    expect(fs.mkdirSync).toHaveBeenCalledWith(mockDir, { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      mockFile,
      expect.stringContaining('run-1'),
      'utf-8',
    );
  });

  it('should update an existing run', async () => {
    const mockRun: SubagentRunRecord = {
      runId: 'run-1',
      childSessionKey: 'session-1',
      requesterSessionKey: 'main',
      requesterDisplayKey: 'Main',
      task: 'test task',
      cleanup: 'keep',
      createdAt: 3000,
    };
    await registry.registerRun(mockRun);

    await registry.updateRun('run-1', { endedAt: 4000 });

    const updated = registry.getRun('run-1');
    expect(updated?.endedAt).toBe(4000);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(2); // Register + Update
  });

  it('should list runs for a requester', async () => {
    const run1: SubagentRunRecord = {
      runId: 'run-1',
      childSessionKey: 's1',
      requesterSessionKey: 'req-A',
      requesterDisplayKey: 'A',
      task: 't1',
      cleanup: 'keep',
      createdAt: 1,
    };
    const run2: SubagentRunRecord = {
      runId: 'run-2',
      childSessionKey: 's2',
      requesterSessionKey: 'req-B',
      requesterDisplayKey: 'B',
      task: 't2',
      cleanup: 'keep',
      createdAt: 2,
    };
    await registry.registerRun(run1);
    await registry.registerRun(run2);

    const listA = registry.listRunsForRequester('req-A');
    expect(listA).toHaveLength(1);
    expect(listA[0].runId).toBe('run-1');
  });
});
