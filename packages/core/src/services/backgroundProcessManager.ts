/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { debugLogger } from '../utils/debugLogger.js';

/**
 * Manages background processes spawned by the agent to ensure they are cleaned up on exit.
 */
export class BackgroundProcessManager {
  private static instance: BackgroundProcessManager;
  private pids: Set<number> = new Set();

  private constructor() {}

  static getInstance(): BackgroundProcessManager {
    if (!BackgroundProcessManager.instance) {
      BackgroundProcessManager.instance = new BackgroundProcessManager();
    }
    return BackgroundProcessManager.instance;
  }

  /**
   * Registers a process ID to be cleaned up on exit.
   */
  register(pid: number) {
    this.pids.add(pid);
  }

  /**
   * Unregisters a process ID (e.g. if it exited naturally).
   */
  unregister(pid: number) {
    this.pids.delete(pid);
  }

  /**
   * Kills all registered processes.
   */
  cleanup() {
    if (this.pids.size === 0) {
      return;
    }

    debugLogger.log(
      'BackgroundProcessManager',
      `Cleaning up ${this.pids.size} background processes...`,
    );

    for (const pid of this.pids) {
      try {
        // specific check for existence before killing
        try {
          process.kill(pid, 0);
        } catch (_e) {
          // Process doesn't exist
          this.pids.delete(pid);
          continue;
        }

        debugLogger.log('BackgroundProcessManager', `Killing process ${pid}`);
        // Try SIGTERM first
        try {
          process.kill(-pid, 'SIGTERM'); // Try killing process group
        } catch {
          process.kill(pid, 'SIGTERM');
        }

        // We assume it works or the OS handles it.
        // We could implement a wait/retry with SIGKILL but for now fire-and-forget is better than hanging exit.
      } catch (error) {
        debugLogger.error(
          'BackgroundProcessManager',
          `Failed to kill process ${pid}:`,
          error,
        );
      }
    }
    this.pids.clear();
  }
}
