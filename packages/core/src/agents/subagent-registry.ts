/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Storage } from '../config/storage.js';
import { debugLogger } from '../utils/debugLogger.js';
import { getErrorMessage } from '../utils/errors.js';
import { type DeliveryContext } from '../utils/delivery-context.js';

export interface SubagentRunOutcome {
  status: 'ok' | 'error' | 'timeout' | 'unknown';
  error?: string;
}

export interface SubagentRunRecord {
  runId: string;
  childSessionKey: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  task: string;
  cleanup: 'delete' | 'keep';
  label?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  outcome?: SubagentRunOutcome;
  archiveAtMs?: number;
  cleanupCompletedAt?: number;
  cleanupHandled?: boolean;
}

export class SubagentRegistry {
  private runs = new Map<string, SubagentRunRecord>();
  private loaded = false;
  private sweeper: NodeJS.Timeout | null = null;

  async load(): Promise<void> {
    if (this.loaded) return;

    const dir = Storage.getSubagentsDir();
    const filePath = path.join(dir, 'registry.json');
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(content) as Record<string, SubagentRunRecord>;
        this.runs = new Map(Object.entries(data));
      }
    } catch (error: unknown) {
      debugLogger.error(
        'Failed to load subagent registry:',
        getErrorMessage(error),
      );
      this.runs.clear();
    }
    this.loaded = true;
    this.startSweeper();
  }

  async save(): Promise<void> {
    const dir = Storage.getSubagentsDir();
    const filePath = path.join(dir, 'registry.json');
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const data = Object.fromEntries(this.runs.entries());
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      debugLogger.error(
        'Failed to save subagent registry:',
        getErrorMessage(error),
      );
    }
  }

  getRun(runId: string): SubagentRunRecord | undefined {
    return this.runs.get(runId);
  }

  async registerRun(record: SubagentRunRecord): Promise<void> {
    await this.load();
    this.runs.set(record.runId, record);
    await this.save();
    this.startSweeper(); // Ensure sweeper is running if we add a new run
  }

  async updateRun(
    runId: string,
    updates: Partial<SubagentRunRecord>,
  ): Promise<void> {
    await this.load();
    const existing = this.runs.get(runId);
    if (!existing) return;

    Object.assign(existing, updates);
    await this.save();
  }

  async deleteRun(runId: string): Promise<void> {
    await this.load();
    if (this.runs.delete(runId)) {
      await this.save();
    }
  }

  startSweeper() {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      void this.sweep();
    }, 60_000);
    this.sweeper.unref?.();
  }

  stopSweeper() {
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }

  private async sweep() {
    await this.load();
    const now = Date.now();
    let mutated = false;
    for (const [runId, entry] of this.runs.entries()) {
      if (entry.archiveAtMs && entry.archiveAtMs <= now) {
        this.runs.delete(runId);
        mutated = true;
        // logic to delete transcript can go here or be handled by the caller/cleanup flow
      }
    }
    if (mutated) {
      await this.save();
    }
    if (this.runs.size === 0) {
      this.stopSweeper();
    }
  }

  listRunsForRequester(requesterSessionKey: string): SubagentRunRecord[] {
    const key = requesterSessionKey.trim();
    if (!key) return [];
    return Array.from(this.runs.values()).filter(
      (entry) => entry.requesterSessionKey === key,
    );
  }
}

export const subagentRegistry = new SubagentRegistry();
