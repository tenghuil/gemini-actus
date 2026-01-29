/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  type ToolResult,
  Kind,
  type ToolInvocation,
} from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

interface CompleteTaskParams {
  task_id: string;
  status: 'success' | 'failure';
  reason?: string;
  output_data?: Record<string, unknown>;
}

class CompleteTaskInvocation extends BaseToolInvocation<
  CompleteTaskParams,
  ToolResult
> {
  getDescription(): string {
    return `Complete task ${this.params.task_id} with status ${this.params.status}`;
  }

  async execute(_: AbortSignal): Promise<ToolResult> {
    return {
      llmContent: `Task ${this.params.task_id} marked as ${this.params.status}.`,
      returnDisplay: `Task ${this.params.task_id} completed: ${this.params.status}`,
    };
  }
}

export class CompleteTaskTool extends BaseDeclarativeTool<
  CompleteTaskParams,
  ToolResult
> {
  constructor(messageBus: MessageBus) {
    super(
      'complete_task',
      'Complete Task',
      'Signal that a task has been completed (success or failure).',
      Kind.Other,
      {
        type: 'object',
        properties: {
          task_id: {
            type: 'string',
            description: 'The ID of the task being completed.',
          },
          status: {
            type: 'string',
            enum: ['success', 'failure'],
            description: 'The final status of the task.',
          },
          reason: {
            type: 'string',
            description: 'Optional reason for failure or summary of success.',
          },
          output_data: {
            type: 'object',
            description: 'Optional structured output data.',
          },
        },
        required: ['task_id', 'status'],
      },
      messageBus,
      false, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  protected createInvocation(
    params: CompleteTaskParams,
    messageBus: MessageBus,
    toolName?: string,
    toolDisplayName?: string,
  ): ToolInvocation<CompleteTaskParams, ToolResult> {
    return new CompleteTaskInvocation(
      params,
      messageBus,
      toolName,
      toolDisplayName,
    );
  }
}
