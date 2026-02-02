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
import {
  MessageBusType,
  QuestionType,
  type AskUserRequest,
  type AskUserResponse,
} from '../confirmation-bus/types.js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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

  async execute(signal: AbortSignal): Promise<ToolResult> {
    const { message, secrets } = this.params;
    const correlationId = randomUUID();

    // Map secrets to questions
    // Note: 'header' is used as a short label. We use the secret name,
    // but we might want to truncate it if logic elsewhere enforces 12 chars.
    // However, for now passing full name.
    const questions = secrets.map((s) => ({
      question: `Please enter the value for ${s.name}: ${s.description}`,
      header: s.name,
      type: QuestionType.TEXT,
      placeholder: `Value for ${s.name}`,
    }));

    const request: AskUserRequest = {
      type: MessageBusType.ASK_USER_REQUEST,
      questions,
      correlationId,
    };

    return new Promise<ToolResult>((resolve, reject) => {
      const responseHandler = (response: AskUserResponse): void => {
        if (response.correlationId === correlationId) {
          cleanup();

          if (response.cancelled) {
            resolve({
              llmContent: 'User cancelled the secret request.',
              returnDisplay: 'User cancelled request.',
            });
            return;
          }

          try {
            // Save secrets to .env
            // We'll append to .env in the current working directory.
            // A better approach would be to check if the key exists, but appending usually overrides in many parsers
            // (or simplest is just append for now, or check/rewrite).
            // For safety/simplicity in this tool, we simply append.
            const envPath = path.join(process.cwd(), '.env');
            let envContent = '';

            // Check if .env exists to add newline if needed
            if (fs.existsSync(envPath)) {
              const currentContent = fs.readFileSync(envPath, 'utf-8');
              if (currentContent && !currentContent.endsWith('\n')) {
                envContent += '\n';
              }
            }

            const activeSecrets: string[] = [];

            Object.entries(response.answers).forEach(([index, value]) => {
              const secretIdx = parseInt(index, 10);
              const secretDef = secrets[secretIdx];
              if (secretDef && value) {
                // Determine quoting. If value has spaces, quote it.
                // Simple version.
                const safeValue =
                  value.includes(' ') || value.includes('#')
                    ? `"${value.replace(/"/g, '\\"')}"`
                    : value;
                envContent += `${secretDef.name}=${safeValue}\n`;
                activeSecrets.push(secretDef.name);
              }
            });

            fs.appendFileSync(envPath, envContent);

            resolve({
              llmContent: `Successfully acquired and saved the following secrets to .env: ${activeSecrets.join(', ')}. Context: ${message}`,
              returnDisplay: `Secrets saved to .env: ${activeSecrets.join(', ')}`,
            });
          } catch (err: unknown) {
            const errorMessage =
              err instanceof Error ? err.message : String(err);
            resolve({
              llmContent: `Failed to save secrets to .env: ${errorMessage}`,
              returnDisplay: `Error saving secrets: ${errorMessage}`,
              error: { message: errorMessage },
            });
          }
        }
      };

      const cleanup = () => {
        this.messageBus.unsubscribe(
          MessageBusType.ASK_USER_RESPONSE,
          responseHandler,
        );
        signal.removeEventListener('abort', abortHandler);
      };

      const abortHandler = () => {
        cleanup();
        resolve({
          llmContent: 'Tool execution cancelled.',
          returnDisplay: 'Cancelled',
          error: { message: 'Cancelled' },
        });
      };

      if (signal.aborted) {
        abortHandler();
        return;
      }

      signal.addEventListener('abort', abortHandler);
      this.messageBus.subscribe(
        MessageBusType.ASK_USER_RESPONSE,
        responseHandler,
      );

      this.messageBus.publish(request).catch((err) => {
        cleanup();
        reject(err);
      });
    });
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
