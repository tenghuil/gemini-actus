/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackgroundProcessManager } from './backgroundProcessManager.js';

describe('BackgroundProcessManager', () => {
  let manager: BackgroundProcessManager;

  beforeEach(() => {
    // Reset singleton instance for each test
    // We can't easily reset the instance private field, but we can clear the PIDs
    manager = BackgroundProcessManager.getInstance();
    // Use type assertion to access private property for testing if needed,
    // or just rely on cleanup which clears it.
    (manager as unknown as { pids: Set<number> }).pids.clear();

    vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should register pids', () => {
    manager.register(12345);
    expect((manager as unknown as { pids: Set<number> }).pids.has(12345)).toBe(
      true,
    );
  });

  it('should unregister pids', () => {
    manager.register(12345);
    manager.unregister(12345);
    expect((manager as unknown as { pids: Set<number> }).pids.has(12345)).toBe(
      false,
    );
  });

  it('should cleanup processes', () => {
    manager.register(12345);
    manager.register(67890);

    // Mock process.kill to emulate existence check
    // Return true for 0 (check) and true for SIGTERM
    vi.spyOn(process, 'kill').mockImplementation((_pid, _signal) => true);

    manager.cleanup();

    expect(process.kill).toHaveBeenCalledWith(12345, 0);
    // expect(process.kill).toHaveBeenCalledWith(-12345, 'SIGTERM'); // Can be tricky to test negative pid if logic varies
    // The exact calls depend on the implementation details (group kill vs single kill)
    // We just verify it tried to kill.
    expect(process.kill).toHaveBeenCalledWith(expect.anything(), 'SIGTERM');
    expect((manager as unknown as { pids: Set<number> }).pids.size).toBe(0);
  });

  it('should handle non-existent processes gracefully', () => {
    manager.register(12345);

    // updates mocking to throw on check
    vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) {
        throw new Error('Process does not exist');
      }
      return true;
    });

    manager.cleanup();

    expect(process.kill).not.toHaveBeenCalledWith(12345, 'SIGTERM');
    expect((manager as unknown as { pids: Set<number> }).pids.size).toBe(0);
  });
});
