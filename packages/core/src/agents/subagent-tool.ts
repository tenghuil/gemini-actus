/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseDeclarativeTool,
  Kind,
  type ToolInvocation,
  type ToolResult,
  BaseToolInvocation,
  type ToolCallConfirmationDetails,
} from '../tools/tools.js';
import type { AnsiOutput } from '../utils/terminalSerializer.js';
import type { Config } from '../config/config.js';
import type { MessageBus } from '../confirmation-bus/message-bus.js';
import type { AgentDefinition, AgentInputs } from './types.js';
import { SubagentToolWrapper } from './subagent-tool-wrapper.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import { subagentRegistry } from './subagent-registry.js';
// import { debugLogger } from '../utils/debugLogger.js';
import { v4 as uuidv4 } from 'uuid';

export class SubagentTool extends BaseDeclarativeTool<AgentInputs, ToolResult> {
  constructor(
    private readonly definition: AgentDefinition,
    private readonly config: Config,
    messageBus: MessageBus,
  ) {
    const inputSchema = definition.inputConfig.inputSchema;

    // Validate schema on construction
    const schemaError = SchemaValidator.validateSchema(inputSchema);
    if (schemaError) {
      throw new Error(
        `Invalid schema for agent ${definition.name}: ${schemaError}`,
      );
    }

    super(
      definition.name,
      definition.displayName ?? definition.name,
      definition.description,
      Kind.Think,
      inputSchema,
      messageBus,
      /* isOutputMarkdown */ true,
      /* canUpdateOutput */ true,
    );
  }

  protected createInvocation(
    params: AgentInputs,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ): ToolInvocation<AgentInputs, ToolResult> {
    return new SubAgentInvocation(
      params,
      this.definition,
      this.config,
      messageBus,
      _toolName,
      _toolDisplayName,
    );
  }
}

class SubAgentInvocation extends BaseToolInvocation<AgentInputs, ToolResult> {
  private runId: string;

  constructor(
    params: AgentInputs,
    private readonly definition: AgentDefinition,
    private readonly config: Config,
    messageBus: MessageBus,
    _toolName?: string,
    _toolDisplayName?: string,
  ) {
    super(
      params,
      messageBus,
      _toolName ?? definition.name,
      _toolDisplayName ?? definition.displayName ?? definition.name,
    );
    this.runId = uuidv4();
  }

  getDescription(): string {
    return `Delegating to agent '${this.definition.displayName ?? this.definition.name}'`;
  }

  override async shouldConfirmExecute(
    abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    if (this.definition.kind !== 'remote') {
      // Local agents should execute without confirmation. Inner tool calls will bubble up their own confirmations to the user.
      return false;
    }

    const invocation = this.buildSubInvocation(this.definition, this.params);
    return invocation.shouldConfirmExecute(abortSignal);
  }

  async execute(
    signal: AbortSignal,
    updateOutput?: (output: string | AnsiOutput) => void,
  ): Promise<ToolResult> {
    const validationError = SchemaValidator.validate(
      this.definition.inputConfig.inputSchema,
      this.params,
    );

    if (validationError) {
      throw new Error(
        `Invalid arguments for agent '${this.definition.name}': ${validationError}. Input schema: ${JSON.stringify(this.definition.inputConfig.inputSchema)}.`,
      );
    }

    // Register run start
    try {
      await subagentRegistry.registerRun({
        runId: this.runId,
        childSessionKey: `subagent:${this.runId}`, // Virtual session key for now
        requesterSessionKey: 'main', // TODO: Pass actual session key
        requesterDisplayKey: 'Main',
        task: this.definition.name, // Using agent name as task for now
        cleanup: 'keep',
        createdAt: Date.now(),
        startedAt: Date.now(),
      });
    } catch (_e) {
      // Log but continue if registry fails
      // debugLogger.error('Failed to register subagent run:', e);
    }

    const invocation = this.buildSubInvocation(this.definition, this.params);

    try {
      const result = await invocation.execute(signal, updateOutput);

      // Update run success
      await subagentRegistry.updateRun(this.runId, {
        endedAt: Date.now(),
        outcome: { status: 'ok' },
      });

      return result;
    } catch (error: unknown) {
      // Update run failure
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await subagentRegistry.updateRun(this.runId, {
        endedAt: Date.now(),
        outcome: { status: 'error', error: errorMessage },
      });
      throw error;
    }
  }

  private buildSubInvocation(
    definition: AgentDefinition,
    agentArgs: AgentInputs,
  ): ToolInvocation<AgentInputs, ToolResult> {
    const wrapper = new SubagentToolWrapper(
      definition,
      this.config,
      this.messageBus,
    );

    return wrapper.build(agentArgs);
  }
}
