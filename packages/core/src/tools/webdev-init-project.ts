/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { WEBDEV_INIT_PROJECT_TOOL_NAME } from './tool-names.js';
import type { Config } from '../config/config.js';
import type { ToolResult, ToolInvocation } from './tools.js';
import {
  BaseDeclarativeTool,
  BaseToolInvocation,
  Kind,
  type ToolConfirmationOutcome,
  type ToolCallConfirmationDetails,
  type ToolLocation,
} from './tools.js';
import { ToolErrorType } from './tool-error.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import { logFileOperation } from '../telemetry/loggers.js';
import { FileOperationEvent } from '../telemetry/types.js';
import { FileOperation } from '../telemetry/metrics.js';
import { getSpecificMimeType } from '../utils/fileUtils.js';
import { getLanguageFromFilePath } from '../utils/language-detection.js';

/**
 * Parameters for the WebdevInitProject tool
 */
export interface WebdevInitProjectToolParams {
  /**
   * The name of the project directory.
   */
  project_name: string;

  /**
   * The human-readable title of the project.
   */
  project_title: string;

  /**
   * The project template to use ('web-static' or 'web-db-user').
   */
  features?: string;
}

class WebdevInitProjectToolInvocation extends BaseToolInvocation<
  WebdevInitProjectToolParams,
  ToolResult
> {
  private readonly targetPath: string;
  private readonly templatePath: string;

  constructor(
    private readonly config: Config,
    params: WebdevInitProjectToolParams,
    messageBus: MessageBus,
    toolName?: string,
    displayName?: string,
  ) {
    super(params, messageBus, toolName, displayName);
    this.targetPath = path.resolve(
      this.config.getTargetDir(),
      this.params.project_name,
    );

    // Locate templates relative to the package root (dist/.. or src/..)
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Check for templates in common locations relative to this file
    // 1. ../../templates (src development)
    // 2. ../../../templates (dist production, where structure is dist/src/tools)
    const candidates = [
      path.resolve(__dirname, '..', '..', 'templates'),
      path.resolve(__dirname, '..', '..', '..', 'templates'),
    ];

    const templateBase =
      candidates.find((p) => fs.existsSync(p)) || candidates[0];

    const features = this.params.features || 'web-db-user';
    this.templatePath = path.resolve(templateBase, features);
  }

  override toolLocations(): ToolLocation[] {
    return [{ path: this.targetPath }];
  }

  override getDescription(): string {
    return `Initializing web project "${this.params.project_name}" using template "${this.params.features || 'web-db-user'}"`;
  }

  protected override async getConfirmationDetails(
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'info',
      title: `Confirm Project Initialization: ${this.params.project_name}`,
      prompt: `Initialize new project in ${this.params.project_name} using template ${this.params.features || 'web-db-user'}?\nTarget: ${this.targetPath}`,
      onConfirm: async (outcome: ToolConfirmationOutcome) => {
        await this.publishPolicyUpdate(outcome);
      },
    };
    return confirmationDetails;
  }

  async execute(_abortSignal: AbortSignal): Promise<ToolResult> {
    const {
      project_name,
      project_title,
      features = 'web-db-user',
    } = this.params;

    // 1. Validate Target Path
    const validationError = this.config.validatePathAccess(this.targetPath);
    if (validationError) {
      return {
        llmContent: validationError,
        returnDisplay: `Error: Path not in workspace: ${validationError}`,
        error: {
          message: validationError,
          type: ToolErrorType.PATH_NOT_IN_WORKSPACE,
        },
      };
    }

    if (fs.existsSync(this.targetPath)) {
      return {
        llmContent: `Error: Target directory ${this.targetPath} already exists.`,
        returnDisplay: `Error: Target directory ${this.targetPath} already exists.`,
        error: {
          message: `Target directory ${this.targetPath} already exists.`,
          type: ToolErrorType.ATTEMPT_TO_CREATE_EXISTING_FILE,
        },
      };
    }

    // 2. Validate Template Path
    if (!fs.existsSync(this.templatePath)) {
      return {
        llmContent: `Error: Template '${features}' not found at ${this.templatePath}.`,
        returnDisplay: `Error: Template '${features}' not found.`,
        error: {
          message: `Template '${features}' not found at ${this.templatePath}`,
          type: ToolErrorType.INVALID_TOOL_PARAMS,
        },
      };
    }

    try {
      // 3. Copy Template
      await fs.promises.cp(this.templatePath, this.targetPath, {
        recursive: true,
      });

      // 5. Read README.md
      const readmePath = path.join(this.targetPath, 'README.md');
      let readmeContent = '';
      if (fs.existsSync(readmePath)) {
        readmeContent = await fs.promises.readFile(readmePath, 'utf-8');
      }

      logFileOperation(
        this.config,
        new FileOperationEvent(
          WEBDEV_INIT_PROJECT_TOOL_NAME,
          FileOperation.CREATE,
          readmeContent.split('\n').length,
          getSpecificMimeType(readmePath),
          path.extname(readmePath),
          getLanguageFromFilePath(readmePath),
        ),
      );

      const resultMsg = `Project "${project_name}" (${project_title}) created successfully at ${this.targetPath}.\n\n=== Current Template README.md ===\n\n${readmeContent}`;

      return {
        llmContent: resultMsg,
        returnDisplay: resultMsg,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error initializing project: ${errorMsg}`,
        returnDisplay: `Error initializing project: ${errorMsg}`,
        error: {
          message: errorMsg,
          type: ToolErrorType.EXECUTION_FAILED,
        },
      };
    }
  }
}

/**
 * Tool for initializing a new web project from templates.
 */
export class WebdevInitProjectTool extends BaseDeclarativeTool<
  WebdevInitProjectToolParams,
  ToolResult
> {
  static readonly Name = WEBDEV_INIT_PROJECT_TOOL_NAME;

  constructor(
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    super(
      WebdevInitProjectTool.Name,
      'WebdevInitProject',
      `Initialize a new web project with a specific template.

      Available Templates:
      - 'web-static': Pure React + Tailwind + shadcn/ui. Client-side routing only. Use this for landing pages, prototypes, or apps without a backend.
      - 'web-db-user' (default): Full-stack React + Express + tRPC + Drizzle ORM + MySQL + Authentication. Use this for applications requiring database (MySQL), user login, or API endpoints.
      
      All projects must be initialized in the workspace folder.
      Returns the content of the README.md file from the new project to provide context.`,
      Kind.Edit, // It creates files
      {
        properties: {
          project_name: {
            description: 'The name of the project directory.',
            type: 'string',
          },
          project_title: {
            description: 'The human-readable title of the project.',
            type: 'string',
          },
          features: {
            description:
              "The project template to use ('web-static' or 'web-db-user').",
            type: 'string',
            enum: ['web-static', 'web-db-user'],
          },
        },
        required: ['project_name', 'project_title'],
        type: 'object',
      },
      messageBus,
      true, // isOutputMarkdown
    );
  }

  protected createInvocation(
    params: WebdevInitProjectToolParams,
    messageBus: MessageBus,
  ): ToolInvocation<WebdevInitProjectToolParams, ToolResult> {
    return new WebdevInitProjectToolInvocation(
      this.config,
      params,
      messageBus ?? this.messageBus,
      this.name,
      this.displayName,
    );
  }
}
