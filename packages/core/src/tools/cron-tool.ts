/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '../config/config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolInvocation,
  type ToolResult,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';

export interface CronToolParams {
  action: 'add' | 'update' | 'remove' | 'list' | 'run' | 'status';
  job?: any;
  jobId?: string;
  patch?: any;
  includeDisabled?: boolean;
  mode?: 'force' | 'due';
}

class CronToolInvocation extends BaseToolInvocation<CronToolParams, ToolResult> {
  constructor(
    private readonly config: Config,
    params: CronToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    return `Cron tool action: ${this.params.action}`;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const cronService = this.config.getCronService();
    if (!cronService) {
      return {
        llmContent: 'CronService is not available in this environment.',
        returnDisplay: 'CronService is not available in this environment.',
        error: {
          message: 'CronService is not available in this environment.',
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }

    try {
      let resultMessage = '';
      switch (this.params.action) {
        case 'add': {
          if (!this.params.job) throw new Error('Missing "job" parameter for add action');
          const jobInput = {
            ...this.params.job,
            contextId: this.config.getSessionId()
          };
          const job = await cronService.add(jobInput);
          resultMessage = `Successfully added cron job. ID: ${job.id}`;
          break;
        }
        case 'update': {
          if (!this.params.jobId || !this.params.patch) throw new Error('Missing "jobId" or "patch" for update action');
          const job = await cronService.update(this.params.jobId, this.params.patch);
          resultMessage = `Successfully updated cron job. New state: ${JSON.stringify(job, null, 2)}`;
          break;
        }
        case 'remove': {
          if (!this.params.jobId) throw new Error('Missing "jobId" for remove action');
          const result = await cronService.remove(this.params.jobId);
          resultMessage = result.removed ? 'Job removed successfully.' : 'Job not found.';
          break;
        }
        case 'list': {
          const jobs = await cronService.list({ includeDisabled: this.params.includeDisabled });
          resultMessage = jobs.length === 0 ? 'No cron jobs found.' : JSON.stringify(jobs, null, 2);
          break;
        }
        case 'run': {
          if (!this.params.jobId) throw new Error('Missing "jobId" for run action');
          const result = await cronService.run(this.params.jobId, this.params.mode);
          resultMessage = result.ran ? 'Job ran successfully.' : 'Job did not run (maybe not due or not found).';
          break;
        }
        case 'status': {
          const jobs = await cronService.list({ includeDisabled: true });
          const pending = jobs.filter(j => j.enabled);
          resultMessage = `Cron Service is active. ${jobs.length} total jobs (${pending.length} enabled).`;
          break;
        }
        default:
          throw new Error(`Unknown action: ${this.params.action}`);
      }

      return {
        llmContent: resultMessage,
        returnDisplay: `Executed cron action: ${this.params.action}`,
      };
    } catch (error) {
      const errorMsg = `Error executing cron action: ${error instanceof Error ? error.message : String(error)}`;
      return {
        llmContent: errorMsg,
        returnDisplay: 'Failed to execute cron action.',
        error: {
          message: errorMsg,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

export class CronTool extends BaseDeclarativeTool<CronToolParams, ToolResult> {
  static readonly Name = 'cron';

  constructor(
    private config: Config,
    messageBus: MessageBus,
  ) {
    super(
      CronTool.Name,
      'Cron',
      'Manage background cron jobs. You can add scheduled tasks that will spin up an isolated agent to perform work. Use this to set reminders, run background loops, or schedule future actions.',
      Kind.Execute,
      {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['add', 'update', 'remove', 'list', 'run', 'status'],
            description: 'The cron action to perform.',
          },
          job: {
            type: 'object',
            description: 'Provide this when action is "add". Contains properties like name, schedule ({kind:"at","at":"..."}, {kind:"every","everyMs":...}, {kind:"cron","expr":"..."}), and payload ({kind:"agentTurn", message:"..."}).',
          },
          jobId: {
            type: 'string',
            description: 'Provide this when action is "update", "remove", or "run".',
          },
          patch: {
            type: 'object',
            description: 'Provide this when action is "update". Partial job fields to update.',
          },
          includeDisabled: {
            type: 'boolean',
            description: 'Optional. Used when action is "list".',
          },
          mode: {
            type: 'string',
            enum: ['force', 'due'],
            description: 'Optional. Used when action is "run". "force" ignores schedule.',
          },
        },
        required: ['action'],
      },
      messageBus,
      true,
      false,
    );
  }

  protected createInvocation(
    params: CronToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<CronToolParams, ToolResult> {
    return new CronToolInvocation(
      this.config,
      params,
      messageBus ?? this.messageBus,
      _toolName,
      _toolDisplayName,
    );
  }
}
