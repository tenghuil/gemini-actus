/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import express from 'express';
import { z } from 'zod';

import type { AgentCard, Message } from '@a2a-js/sdk';
import type { TaskStore } from '@a2a-js/sdk/server';
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  DefaultExecutionEventBus,
  type AgentExecutionEvent,
} from '@a2a-js/sdk/server';
import { A2AExpressApp } from '@a2a-js/sdk/server/express'; // Import server components
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ConversationRecord,
  ResumedSessionData,
} from '@google/gemini-actus-core';
import { logger } from '../utils/logger.js';
import type { AgentSettings } from '../types.js';
import { GCSTaskStore, NoOpTaskStore } from '../persistence/gcs.js';
import { CoderAgentExecutor } from '../agent/executor.js';
import { requestStorage } from './requestStorage.js';
import { loadConfig, loadEnvironment, setTargetDir } from '../config/config.js';
import { loadSettings } from '../config/settings.js';
import { loadExtensions } from '../config/extension.js';
import { commandRegistry } from '../commands/command-registry.js';
import { debugLogger, SimpleExtensionLoader } from '@google/gemini-actus-core';
import type { Command, CommandArgument } from '../commands/types.js';
import { GitService } from '@google/gemini-actus-core';
import { AgentRegistry, CronService, LocalAgentExecutor, type LocalAgentDefinition, ApprovalMode, PolicyDecision } from '@google/gemini-actus-core';

type CommandResponse = {
  name: string;
  description: string;
  arguments: CommandArgument[];
  subCommands: CommandResponse[];
};

const coderAgentCard: AgentCard = {
  name: 'Gemini SDLC Agent',
  description:
    'An agent that generates code based on natural language instructions and streams file outputs.',
  url: 'http://localhost:41242/',
  provider: {
    organization: 'Google',
    url: 'https://google.com',
  },
  protocolVersion: '0.3.0',
  version: '0.0.2', // Incremented version
  capabilities: {
    streaming: true,
    pushNotifications: false,
    stateTransitionHistory: true,
  },
  securitySchemes: undefined,
  security: undefined,
  defaultInputModes: ['text'],
  defaultOutputModes: ['text'],
  skills: [
    {
      id: 'code_generation',
      name: 'Code Generation',
      description:
        'Generates code snippets or complete files based on user requests, streaming the results.',
      tags: ['code', 'development', 'programming'],
      examples: [
        'Write a python function to calculate fibonacci numbers.',
        'Create an HTML file with a basic button that alerts "Hello!" when clicked.',
      ],
      inputModes: ['text'],
      outputModes: ['text'],
    },
  ],
  supportsAuthenticatedExtendedCard: false,
};

export function updateCoderAgentCardUrl(port: number) {
  coderAgentCard.url = `http://localhost:${port}/`;
}

async function handleExecuteCommand(
  req: express.Request,
  res: express.Response,
  context: {
    config: Awaited<ReturnType<typeof loadConfig>>;
    git: GitService | undefined;
    agentExecutor: CoderAgentExecutor;
  },
) {
  logger.info('[CoreAgent] Received /executeCommand request: ', req.body);
  const { command, args } = req.body;
  try {
    if (typeof command !== 'string') {
      return res.status(400).json({ error: 'Invalid "command" field.' });
    }

    if (args && !Array.isArray(args)) {
      return res.status(400).json({ error: '"args" field must be an array.' });
    }

    const commandToExecute = commandRegistry.get(command);

    if (commandToExecute?.requiresWorkspace) {
      if (!process.env['CODER_AGENT_WORKSPACE_PATH']) {
        return res.status(400).json({
          error: `Command "${command}" requires a workspace, but CODER_AGENT_WORKSPACE_PATH is not set.`,
        });
      }
    }

    if (!commandToExecute) {
      return res.status(404).json({ error: `Command not found: ${command}` });
    }

    if (commandToExecute.streaming) {
      const eventBus = new DefaultExecutionEventBus();
      res.setHeader('Content-Type', 'text/event-stream');
      const eventHandler = (event: AgentExecutionEvent) => {
        const jsonRpcResponse = {
          jsonrpc: '2.0',
          id: 'taskId' in event ? event.taskId : (event as Message).messageId,
          result: event,
        };
        res.write(`data: ${JSON.stringify(jsonRpcResponse)}\n`);
      };
      eventBus.on('event', eventHandler);

      await commandToExecute.execute({ ...context, eventBus }, args ?? []);

      eventBus.off('event', eventHandler);
      eventBus.finished();
      return res.end(); // Explicit return for streaming path
    } else {
      const result = await commandToExecute.execute(context, args ?? []);
      logger.info('[CoreAgent] Sending /executeCommand response: ', result);
      return res.status(200).json(result);
    }
  } catch (e) {
    logger.error(
      `Error executing /executeCommand: ${command} with args: ${JSON.stringify(
        args,
      )}`,
      e,
    );
    const errorMessage =
      e instanceof Error ? e.message : 'Unknown error executing command';
    return res.status(500).json({ error: errorMessage });
  }
}

export async function createApp() {
  try {
    // Load the server configuration once on startup.
    const workspaceRoot = setTargetDir(undefined);
    loadEnvironment();
    const settings = loadSettings(workspaceRoot);
    const extensions = loadExtensions(workspaceRoot);
    const config = await loadConfig(
      settings,
      new SimpleExtensionLoader(extensions),
      'a2a-server',
    );

    let git: GitService | undefined;
    if (config.getCheckpointingEnabled()) {
      git = new GitService(config.getTargetDir(), config.storage);
      await git.initialize();
    }

    const agentRegistry = new AgentRegistry(config);
    await agentRegistry.initialize();

    const cronStorePath = path.join(config.getTargetDir(), 'cron-store.json');
    const cronService = new CronService(cronStorePath, {
      onAgentTurn: async (message: string, timeoutSeconds?: number, contextId?: string) => {
        logger.info(`[CRON] Firing agent turn with message: "${message}", contextId: ${contextId}`);
        const cronAgentDef: LocalAgentDefinition = {
          name: 'cron-agent',
          description: 'A dedicated internal agent for executing background cron jobs autonomously.',
          kind: 'local',
          inputConfig: {
            inputSchema: {
              type: 'object',
              properties: {
                request: { type: 'string', description: 'The scheduled task instruction.' },
              },
              required: ['request'],
            },
          },
          outputConfig: {
            outputName: 'result',
            description: 'The execution result message.',
            schema: z.unknown(),
          },
          modelConfig: { model: 'inherit' },
          runConfig: { maxTimeMinutes: 5, maxTurns: 10 },
          get toolConfig() {
            const tools = config.getToolRegistry().getAllToolNames().filter(t => t !== 'complete_task');
            return { tools };
          },
          promptConfig: {
            systemPrompt: 'You are an autonomous background agent running a scheduled cron job. Execute the user request immediately using your tools. Do not ask for permissions or confirmations from the user. You are fully authorized to proceed. Once done, return a concise summary of the result.',
            query: '${request}'
          }
        };

        config.modelConfigService.registerRuntimeModelConfig(
          `${cronAgentDef.name}-config`,
          {
            modelConfig: {
              model: config.getModel(),
            },
          }
        );

        const cronConfig = new Proxy(config, {
          get(target, prop, receiver) {
            if (prop === 'getApprovalMode') {
              return () => ApprovalMode.YOLO;
            }
            if (prop === 'getPolicyEngine') {
              return () => {
                const engine = target.getPolicyEngine();
                return new Proxy(engine, {
                  get(engineTarget, engineProp) {
                    if (engineProp === 'check') {
                      return async () => ({ decision: PolicyDecision.ALLOW, rule: undefined });
                    }
                    if (engineProp === 'getApprovalMode') {
                      return () => ApprovalMode.YOLO;
                    }
                    const value = Reflect.get(engineTarget, engineProp);
                    return typeof value === 'function' ? value.bind(engineTarget) : value;
                  }
                });
              };
            }
            return Reflect.get(target, prop, receiver);
          }
        });

        const executor = await LocalAgentExecutor.create(
          cronAgentDef,
          cronConfig,
          (activity) => {
            if (activity.type === 'THOUGHT_CHUNK' || activity.type === 'TOOL_CALL_START' || activity.type === 'TOOL_CALL_END') {
               logger.debug(`[CRON Agent]: ${JSON.stringify(activity)}`);
            }
          }
        );

        const controller = new AbortController();
        if (timeoutSeconds) {
          setTimeout(() => controller.abort(), timeoutSeconds * 1000);
        }

        try {
          const result = await executor.run({ request: message }, controller.signal);
          logger.info(`[CRON] Agent finished. Reason: ${result.terminate_reason}`);
          
          if (contextId && result.result && typeof result.result === 'string' && result.result.trim().length > 0) {
             const port = process.env['PORT'] || 3000;
             try {
                const fetchResult = await fetch(`http://localhost:${port}/google-chat/internal/push`, {
                   method: 'POST',
                   headers: { 'Content-Type': 'application/json' },
                   body: JSON.stringify({ sessionId: contextId, text: result.result })
                });
                if (!fetchResult.ok) {
                   logger.error(`[CRON] Failed to forward message to Google Chat Gateway: ${fetchResult.statusText}`);
                } else {
                   logger.info(`[CRON] Successfully forwarded message to session ${contextId}`);
                }
             } catch (e) {
                logger.error(`[CRON] Error notifying Gateway:`, e);
             }
          }
        } catch (e) {
          logger.error(`[CRON] Agent failed:`, e);
        }
      }
    });

    config.setCronService(cronService);

    // We will start cronService after express setup


    // loadEnvironment() is called within getConfig now
    const bucketName = process.env['GCS_BUCKET_NAME'];
    let taskStoreForExecutor: TaskStore;
    let taskStoreForHandler: TaskStore;

    if (bucketName) {
      logger.info(`Using GCSTaskStore with bucket: ${bucketName}`);
      const gcsTaskStore = new GCSTaskStore(bucketName);
      taskStoreForExecutor = gcsTaskStore;
      taskStoreForHandler = new NoOpTaskStore(gcsTaskStore);
    } else {
      logger.info('Using InMemoryTaskStore');
      const inMemoryTaskStore = new InMemoryTaskStore();
      taskStoreForExecutor = inMemoryTaskStore;
      taskStoreForHandler = inMemoryTaskStore;
    }

    const agentExecutor = new CoderAgentExecutor(taskStoreForExecutor, cronService);

    const context = { config, git, agentExecutor };

    const requestHandler = new DefaultRequestHandler(
      coderAgentCard,
      taskStoreForHandler,
      agentExecutor,
    );

    let expressApp = express();
    expressApp.use((req, res, next) => {
      requestStorage.run({ req }, next);
    });

    const appBuilder = new A2AExpressApp(requestHandler);
    expressApp = appBuilder.setupRoutes(expressApp, '');
    expressApp.use(express.json());

    expressApp.post('/tasks', async (req, res) => {
      try {
        const taskId = req.body.taskId || uuidv4();
        const agentSettings = req.body.agentSettings as
          | AgentSettings
          | undefined;
        const contextId = req.body.contextId || taskId;
        let wrapper = agentExecutor.getTask(taskId);
        if (!wrapper) {
          try {
            // Check if it exists in store but not executor
            const sdkTask = await taskStoreForExecutor.load(taskId);
            if (sdkTask) {
              wrapper = await agentExecutor.reconstruct(sdkTask);
            }
          } catch (_e) {
            // Ignore load errors
          }
        }
        if (!wrapper) {
          let resumedSessionData: ResumedSessionData | undefined;
          try {
            const chatsDir = config.getChatsDir();
            const files = await fs.readdir(chatsDir);
            const matchingFiles = files
              .filter(
                (f) =>
                  f.startsWith('session-') &&
                  f.endsWith('.json') &&
                  f.includes(taskId.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 8)),
              )
              .sort(); // Oldest first

            if (matchingFiles.length > 0) {
              const latestFile = matchingFiles[matchingFiles.length - 1];
              const filePath = path.join(chatsDir, latestFile);
              const fileContent = await fs.readFile(filePath, 'utf8');
              const conversation = JSON.parse(
                fileContent,
              ) as ConversationRecord;

              if (conversation.sessionId === taskId) {
                resumedSessionData = {
                  conversation,
                  filePath,
                };
                logger.info(
                  `Found existing session history for task ${taskId}: ${filePath}`,
                );
              }
            }
          } catch (e) {
            // Ignore if directory doesn't exist or file can't be read
            logger.debug(
              `Could not load session history for task ${taskId}: ${e}`,
            );
          }

          wrapper = await agentExecutor.createTask(
            taskId,
            contextId,
            agentSettings,
            undefined, // eventBus
            resumedSessionData,
          );
          await taskStoreForExecutor.save(wrapper.toSDKTask());
        }
        await taskStoreForExecutor.save(wrapper.toSDKTask());
        res.status(201).json(wrapper.id);
      } catch (error) {
        logger.error('[CoreAgent] Error creating task:', error);
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Unknown error creating task';
        res.status(500).send({ error: errorMessage });
      }
    });

    expressApp.post('/executeCommand', (req, res) => {
      void handleExecuteCommand(req, res, context);
    });

    expressApp.get('/listCommands', (req, res) => {
      try {
        const transformCommand = (
          command: Command,
          visited: string[],
        ): CommandResponse | undefined => {
          const commandName = command.name;
          if (visited.includes(commandName)) {
            debugLogger.warn(
              `Command ${commandName} already inserted in the response, skipping`,
            );
            return undefined;
          }

          return {
            name: command.name,
            description: command.description,
            arguments: command.arguments ?? [],
            subCommands: (command.subCommands ?? [])
              .map((subCommand) =>
                transformCommand(subCommand, visited.concat(commandName)),
              )
              .filter(
                (subCommand): subCommand is CommandResponse => !!subCommand,
              ),
          };
        };

        const commands = commandRegistry
          .getAllCommands()
          .filter((command) => command.topLevel)
          .map((command) => transformCommand(command, []));

        return res.status(200).json({ commands });
      } catch (e) {
        logger.error('Error executing /listCommands:', e);
        const errorMessage =
          e instanceof Error ? e.message : 'Unknown error listing commands';
        return res.status(500).json({ error: errorMessage });
      }
    });

    expressApp.get('/tasks/metadata', async (req, res) => {
      // This endpoint is only meaningful if the task store is in-memory.
      if (!(taskStoreForExecutor instanceof InMemoryTaskStore)) {
        res.status(501).send({
          error:
            'Listing all task metadata is only supported when using InMemoryTaskStore.',
        });
      }
      try {
        const wrappers = agentExecutor.getAllTasks();
        if (wrappers && wrappers.length > 0) {
          const tasksMetadata = await Promise.all(
            wrappers.map((wrapper) => wrapper.task.getMetadata()),
          );
          res.status(200).json(tasksMetadata);
        } else {
          res.status(204).send();
        }
      } catch (error) {
        logger.error('[CoreAgent] Error getting all task metadata:', error);
        const errorMessage =
          error instanceof Error
            ? error.message
            : 'Unknown error getting task metadata';
        res.status(500).send({ error: errorMessage });
      }
    });

    expressApp.get('/tasks/:taskId/metadata', async (req, res) => {
      const taskId = req.params.taskId;
      let wrapper = agentExecutor.getTask(taskId);
      if (!wrapper) {
        const sdkTask = await taskStoreForExecutor.load(taskId);
        if (sdkTask) {
          wrapper = await agentExecutor.reconstruct(sdkTask);
        }
      }
      if (!wrapper) {
        res.status(404).send({ error: 'Task not found' });
        return;
      }
      res.json({ metadata: await wrapper.task.getMetadata() });
    });

    // Start cron service
    await cronService.start();
    logger.info('[CRON] CronService started successfully.');

    // Attach cronService to app context or similar if needed for shutdown
    (expressApp as any).cronService = cronService;

    return expressApp;
  } catch (error) {
    logger.error('[CoreAgent] Error during startup:', error);
    process.exit(1);
  }
}

export async function main() {
  try {
    const expressApp = await createApp();
    const port = Number(process.env['CODER_AGENT_PORT'] || 0);

    const server = expressApp.listen(port, 'localhost', () => {
      const address = server.address();
      let actualPort;
      if (process.env['CODER_AGENT_PORT']) {
        actualPort = process.env['CODER_AGENT_PORT'];
      } else if (address && typeof address !== 'string') {
        actualPort = address.port;
      } else {
        throw new Error('[Core Agent] Could not find port number.');
      }
      updateCoderAgentCardUrl(Number(actualPort));
      logger.info(
        `[CoreAgent] Agent Server started on http://localhost:${actualPort}`,
      );
      logger.info(
        `[CoreAgent] Agent Card: http://localhost:${actualPort}/.well-known/agent-card.json`,
      );
      logger.info('[CoreAgent] Press Ctrl+C to stop the server');

      const shutdown = () => {
        logger.info('[CoreAgent] Shutting down server...');
        if ((expressApp as any).cronService) {
          (expressApp as any).cronService.stop();
        }
        server.close(() => {
          logger.info('[CoreAgent] Server closed cleanly.');
          process.exit(0);
        });
        
        // Force exit if connections linger
        setTimeout(() => {
          logger.warn('[CoreAgent] Forcefully exiting process due to hanging connections.');
          process.exit(0);
        }, 1000).unref();
      };

      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });
  } catch (error) {
    logger.error('[CoreAgent] Error during startup:', error);
    process.exit(1);
  }
}
