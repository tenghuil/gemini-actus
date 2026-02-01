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
import { PREVIEW_TOOL_NAME } from './tool-names.js';

export interface PreviewToolParams {
  path?: string;
  url?: string;
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
    if (this.params.url) {
      return `Previewing site at ${this.params.url}`;
    }
    return `Previewing site at ${this.params.path}`;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const target = this.params.url || this.params.path;
    return {
      llmContent: `Previewing site at ${target}`,
      returnDisplay: `Previewing site at ${target}`,
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
      'Preview a website or a local file in the canvas. Use this whenever you build or modify a web page, or when you start a local server, to show the user the result.',
      Kind.Execute,
      {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'The path to the file to preview (e.g. index.html) relative to the current working directory. Use this for static files.',
          },
          url: {
            type: 'string',
            description:
              'The full URL to preview (e.g. http://localhost:3000). Use this when you have a running server or want to show an external site.',
          },
        },
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
