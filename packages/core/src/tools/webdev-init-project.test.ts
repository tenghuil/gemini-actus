/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebdevInitProjectTool } from './webdev-init-project.js';
import { ToolErrorType } from './tool-error.js';
import type { Config } from '../config/config.js';
import { ApprovalMode } from '../policy/types.js';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { WorkspaceContext } from '../utils/workspaceContext.js';
import {
  createMockMessageBus,
  getMockMessageBusInstance,
} from '../test-utils/mock-message-bus.js';

// Don't mock node:fs globally
// vi.mock('node:fs', ...);

const rootDirPrefix = path.resolve(os.tmpdir(), 'gemini-cli-test-root-');

describe('WebdevInitProjectTool', () => {
  let tool: WebdevInitProjectTool;
  let mockConfig: Config;
  let rootDir: string;
  let originalExistsSync: typeof fs.existsSync;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create real temp dir
    rootDir = fs.mkdtempSync(rootDirPrefix);

    // Mock fs methods using spyOn, but keep original behavior for most
    originalExistsSync = fs.existsSync; // Capture original off the module BEFORE spying if it wasn't already spied?
    // Wait, if it was already spied in previous test, we need to restore?
    // vi.restoreAllMocks() is needed? vi.clearAllMocks() does not restore.
    // usage of vi.spyOn repeatedly on same method might stack or fail if we don't restore.
    // Better to use vi.restoreAllMocks() in beforeEach.

    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      const pStr = p.toString();
      // Mock template existence
      if (pStr.includes('templates')) {
        // If we are testing "template not found", we might need another condition.
        // But for now let's assume valid templates exist.
        // We can override this in specific tests.
        return true;
      }
      return originalExistsSync(p);
    });

    // We mock cp to avoid actual copying of non-existent templates
    vi.spyOn(fs.promises, 'cp').mockResolvedValue(undefined);
    vi.spyOn(fs.promises, 'readFile').mockResolvedValue('# Project README');
    // Mock statSync to return a directory for rootDir and its subdirectories
    const originalStatSync = fs.statSync;
    vi.spyOn(fs, 'statSync').mockImplementation((p) => {
      const pStr = p.toString();
      if (pStr.startsWith(rootDir)) {
        // try {
        return originalStatSync(p);
        // } catch (e) {
        //    throw e;
        // }
      }
      return originalStatSync(p);
    });

    // Use usage of real WorkspaceContext with real directory
    const workspaceContext = new WorkspaceContext(rootDir, []);

    mockConfig = {
      getTargetDir: () => rootDir,
      getApprovalMode: vi.fn(() => ApprovalMode.DEFAULT),
      validatePathAccess: vi.fn((p) => {
        if (p.startsWith(rootDir)) return null;
        return 'Path not in workspace';
      }),
      isPathAllowed: vi.fn((p) => p.startsWith(rootDir)),
      getWorkspaceContext: () => workspaceContext,
      getUsageStatisticsEnabled: vi.fn(() => false),
    } as unknown as Config;

    const bus = createMockMessageBus();
    getMockMessageBusInstance(bus).defaultToolDecision = 'ask_user';
    tool = new WebdevInitProjectTool(mockConfig, bus);
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Restore spies
    try {
      if (rootDir && fs.existsSync(rootDir)) {
        fs.rmSync(rootDir, { recursive: true, force: true });
      }
    } catch (_e) {
      // ignore cleanup errors
    }
  });

  describe('build', () => {
    it('should return an invocation for valid params', () => {
      const params = {
        project_name: 'my-project',
        project_title: 'My Project',
        features: 'web-static',
      };
      const invocation = tool.build(params);
      expect(invocation).toBeDefined();
      expect(invocation.params).toEqual(params);
    });
  });

  describe('execute', () => {
    const abortSignal = new AbortController().signal;

    it('should fail if target directory already exists', async () => {
      const params = {
        project_name: 'existing-project',
        project_title: 'Existing Project',
      };
      // Create the directory for real
      const targetPath = path.join(rootDir, 'existing-project');
      fs.mkdirSync(targetPath);

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(
        ToolErrorType.ATTEMPT_TO_CREATE_EXISTING_FILE,
      );
      expect(result.llmContent).toContain('already exists');
    });

    it('should fail if template not found', async () => {
      const params = {
        project_name: 'new-project-bad-template',
        project_title: 'New Project',
        features: 'web-db-user',
      };

      // Override existsSync to fail for this specific template check
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pStr = p.toString();
        // If it's the specific template path, return false
        if (pStr.includes('templates') && pStr.includes('web-db-user')) {
          return false;
        }
        // Use original for others (rootDir check) - BUT we can't easily access originalExistsSync inside this override
        // unless we captured it in outer scope.
        // Fortunately we captured it in `describe` block scope now (let originalExistsSync).
        // But wait, `beforeEach` assigns it. `describe` block variable might be unset if not handled correctly?
        // It is 'let' in describe, set in beforeEach.
        // BUT `vi.mocked` overrides the implementation on the SPY.
        // The spy calls the implementation.

        return originalExistsSync(p);
      });

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
      expect(result.llmContent).toContain("Template 'web-db-user' not found");
    });

    it('should successfully copy template and return readme', async () => {
      const params = {
        project_name: 'success-project',
        project_title: 'Success Project',
        features: 'web-static',
      };

      // Ensure template check returns true
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        const pStr = p.toString();
        if (pStr.includes('templates')) return true; // Template exists

        // Readme check
        if (pStr.endsWith('README.md')) return true;

        return originalExistsSync(p);
      });

      const invocation = tool.build(params);
      const result = await invocation.execute(abortSignal);

      const targetPath = path.resolve(rootDir, 'success-project');

      expect(fs.promises.cp).toHaveBeenCalledWith(
        expect.stringContaining('web-static'),
        targetPath,
        { recursive: true },
      );
      expect(result.error).toBeUndefined();
      expect(result.llmContent).toContain('created successfully');
      expect(result.llmContent).toContain('# Project README');
    });

    it('should fail if path is not in workspace', async () => {
      const params = {
        project_name: 'outside-project',
        project_title: 'Outside Project',
      };

      const invocationOutside = tool.build({
        ...params,
        project_name: '../outside-project',
      });

      const result = await invocationOutside.execute(abortSignal);

      expect(result.error).toBeDefined();
      expect(result.error?.type).toBe(ToolErrorType.PATH_NOT_IN_WORKSPACE);
    });
  });
});
