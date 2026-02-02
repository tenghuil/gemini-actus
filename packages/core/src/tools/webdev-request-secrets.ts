/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { WEBDEV_REQUEST_SECRETS_TOOL_NAME } from './tool-names.js';
import type { ToolResult, ToolInvocation } from './tools.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolCallConfirmationDetails,
} from './tools.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';

export interface SecretRequirement {
  name: string;
  description: string;
}

export interface WebdevRequestSecretsToolParams {
  brief?: string;
  message: string;
  secrets: SecretRequirement[];
}

class WebdevRequestSecretsToolInvocation extends BaseToolInvocation<
  WebdevRequestSecretsToolParams,
  ToolResult
> {
  constructor(
    params: WebdevRequestSecretsToolParams,
    messageBus: MessageBus,
    toolName?: string,
    displayName?: string,
  ) {
    super(params, messageBus, toolName, displayName);
  }

  override getDescription(): string {
    return `Requesting secrets from user: ${this.params.secrets.map((s) => s.name).join(', ')}`;
  }

  protected override async getConfirmationDetails(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    // This tool is purely informational/interactive, but since it involves "secrets",
    // we might want to let the user know what's being asked.
    // However, the tool itself just RETURNS the request to the agent/log.
    // The previous implementation returned a JSON asking the agent to ask the user.
    // Here we can just return the result immediately.
    // If we want implicit confirmation for "Is it okay to ask for these secrets?", we can do that.
    // But usually asking isn't dangerous.
    return false;
  }

  async execute(_signal: AbortSignal): Promise<ToolResult> {
    const { message, secrets } = this.params;
    const secretList = secrets
      .map((s) => `- ${s.name}: ${s.description}`)
      .join('\n');
    const text = `${message}\n\nPlease provide the following secrets:\n${secretList}`;

    return {
      llmContent: text,
      returnDisplay: text,
    };
  }
}

export class WebdevRequestSecretsTool extends BaseDeclarativeTool<
  WebdevRequestSecretsToolParams,
  ToolResult
> {
  static readonly Name = WEBDEV_REQUEST_SECRETS_TOOL_NAME;

  constructor(messageBus: MessageBus) {
    super(
      WebdevRequestSecretsTool.Name,
      'WebdevRequestSecrets',
      `Request the user to provide NEW secrets required for the project (API keys, tokens, credentials, etc.).
      
      Instructions:
      - Present each required secret with its expected environment variable name and purpose
      - Flag mandatory secrets so work pauses until the user supplies them
      - Offer formatting hints when values must follow specific structures or encodings`,
      Kind.Communicate,
      {
        type: 'object',
        properties: {
          brief: {
            type: 'string',
            description: 'A short description of the action.',
          },
          message: {
            type: 'string',
            description:
              'The message to be displayed to the user explaining why secrets are needed.',
          },
          secrets: {
            type: 'array',
            description: 'A list of secrets to request.',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description:
                    'The name of the environment variable or secret.',
                },
                description: {
                  type: 'string',
                  description: 'A description of what the secret is used for.',
                },
              },
              required: ['name', 'description'],
            },
          },
        },
        required: ['message', 'secrets'],
      },
      messageBus,
      true,
    );
  }

  protected createInvocation(
    params: WebdevRequestSecretsToolParams,
    messageBus: MessageBus,
  ): ToolInvocation<WebdevRequestSecretsToolParams, ToolResult> {
    return new WebdevRequestSecretsToolInvocation(
      params,
      messageBus ?? this.messageBus,
      this.name,
      this.displayName,
    );
  }
}
