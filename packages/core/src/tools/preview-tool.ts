/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  Kind,
  type ToolResult,
  type ToolInvocation,
  BaseToolInvocation,
} from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

export const PREVIEW_TOOL_NAME = 'preview_site';

export interface PreviewToolParams {
  path: string;
}

export class PreviewToolInvocation extends BaseToolInvocation<
  PreviewToolParams,
  ToolResult
> {
  constructor(
    params: PreviewToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(params, messageBus, _toolName, _toolDisplayName);
  }

  getDescription(): string {
    return `Previewing site at ${this.params.path}`;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    // This tool is mainly a signal for the frontend.
    // The backend intercepts it to emit an event.
    // But it should also return a success message.
    return {
      llmContent: `Previewing site at ${this.params.path}`,
      returnDisplay: `Previewing site at ${this.params.path}`,
    };
  }
}

export class PreviewTool extends BaseDeclarativeTool<
  PreviewToolParams,
  ToolResult
> {
  static readonly Name = PREVIEW_TOOL_NAME;

  constructor(messageBus: MessageBus) {
    super(
      PreviewTool.Name,
      'Preview Site',
      'Preview a static website in the canvas. Use this whenever you build or modify a web page to show the user the result.',
      Kind.Execute,
      {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'The path to the file to preview (e.g. index.html) relative to the current working directory.',
          },
        },
        required: ['path'],
      },
      messageBus,
      false,
      true,
    );
  }

  protected createInvocation(
    params: PreviewToolParams,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<PreviewToolParams, ToolResult> {
    return new PreviewToolInvocation(
      params,
      messageBus,
      _toolName,
      _toolDisplayName,
    );
  }
}
