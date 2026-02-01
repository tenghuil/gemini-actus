/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CommandModule } from 'yargs';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { createServer } from 'node:http';
// import { WebSocketServer } from 'ws';
import { debugLogger } from '@google/gemini-actus-core';
import type { Config, GeminiClient } from '@google/gemini-actus-core';
import { createRequire } from 'node:module';
import { loadSettings } from '../config/settings.js';
import { loadCliConfig, type CliArgs } from '../config/config.js';
import { initializeApp } from '../core/initializer.js';
import type { FunctionCall, Content, Part } from '@google/genai';
import { HistoryManager } from '../utils/history.js';
import { setupFileSystemRoutes } from './web-routes.js';

const require = createRequire(import.meta.url);

export const webCommand: CommandModule = {
  command: 'web',
  describe: 'Start the Gemini Actus Web UI',
  builder: (yargs) =>
    yargs.option('port', {
      alias: 'p',
      type: 'number',
      default: 3333,
      description: 'Port to run the server on',
    }),
  handler: async (argv) => {
    const port = argv['port'] as number;
    const app = express();
    const server = createServer(app);
    // WebSocket server for future use
    // const _wss = new WebSocketServer({ server });

    app.use(cors());
    app.use(express.json());

    // Initialize app
    const historyManager = new HistoryManager();

    // --- Client Management ---
    interface ClientContext {
      config: Config;
      client: GeminiClient;
      model: string;
      sessionId: string;
    }

    const clientManager = new Map<string, ClientContext>();

    // Keep a base config for general settings
    const baseSettings = loadSettings(process.cwd());

    async function getOrCreateClient(chatId: string): Promise<ClientContext> {
      if (clientManager.has(chatId)) {
        return clientManager.get(chatId)!;
      }

      // Initialize per-chat config
      // We use the chatId as the sessionId to ensure the workspace is .workspace/<chatId>
      const webSettings = {
        ...baseSettings.merged,
        tools: {
          ...baseSettings.merged.tools,
          shell: {
            ...baseSettings.merged.tools?.shell,
            enableInteractiveShell: false,
          },
        },
      };

      const chatConfig = await loadCliConfig(webSettings, chatId, {
        ...argv,
        approvalMode: 'yolo',
      } as unknown as CliArgs);

      await initializeApp(chatConfig, baseSettings);
      await chatConfig.initialize();

      const chatClient = chatConfig.getGeminiClient();
      if (!chatClient) {
        throw new Error(
          'Failed to initialize Gemini Client for chat ' + chatId,
        );
      }

      // Load history
      const savedChat = await historyManager.getChat(chatId);
      if (savedChat && savedChat.messages.length > 0) {
        const historyContent: Content[] = savedChat.messages
          .filter((m) => m.role === 'user' || m.role === 'model')
          .map((m) => ({
            role: m.role as 'user' | 'model',
            parts: [{ text: m.text }],
          }));

        // We need to initialize the client with this history
        // GeminiClient.resumeChat or startChat with history
        await chatClient.resumeChat(historyContent);
      } else {
        await chatClient.initialize();
      }

      const context: ClientContext = {
        config: chatConfig,
        client: chatClient,
        model: chatConfig.getModel(),
        sessionId: chatId,
      };

      clientManager.set(chatId, context);
      return context;
    }
    // --- End Client Management ---

    // --- File System Endpoints ---
    await setupFileSystemRoutes(app);
    // --- End File System Endpoints ---

    app.get('/api/cwd', (req, res) => {
      res.json({ cwd: process.cwd() });
    });
    // --- End File System Endpoints ---

    app.get('/api/history', async (req, res) => {
      try {
        const history = await historyManager.getHistory();
        res.json(history);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    app.get('/api/history/:id', async (req, res) => {
      try {
        const chat = await historyManager.getChat(req.params.id);
        if (!chat) {
          res.status(404).json({ error: 'Chat not found' });
          return;
        }
        res.json(chat);
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    app.delete('/api/history/:id', async (req, res) => {
      try {
        await historyManager.deleteChat(req.params.id);
        // Also remove from active clients
        if (clientManager.has(req.params.id)) {
          clientManager.delete(req.params.id);
        }
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: String(error) });
      }
    });

    app.post('/api/chat', async (req, res) => {
      const { message, chatId: requestedChatId } = req.body;
      if (!message) {
        res.status(400).json({ error: 'Message is required' });
        return;
      }

      let chatId = requestedChatId;
      if (!chatId) {
        const newChat = await historyManager.createChat(message.slice(0, 50));
        chatId = newChat.id;
      }

      // Save user message
      await historyManager.addMessage(chatId, {
        role: 'user',
        text: message,
        timestamp: Date.now(),
      });

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Prevent proxy buffering

      // Send the chatId first so frontend knows
      res.write(`event: chat_id\n`);
      res.write(`data: ${JSON.stringify({ chatId })}\n\n`);

      try {
        const context = await getOrCreateClient(chatId);

        await processTurn(
          context.client,
          context.config,
          context.model,
          [{ text: message }],
          context.sessionId,
          res,
          chatId,
          historyManager,
        );

        // Emit finish event after all process turns are done
        res.write(`event: finish\n`);
        res.write(`data: ${JSON.stringify({ success: true })}\n\n`);
      } catch (error) {
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ message: String(error) })}\n\n`);
        // Save error message
        await historyManager.addMessage(chatId, {
          role: 'error',
          text: String(error),
          timestamp: Date.now(),
        });
      } finally {
        res.end();
      }
    });

    async function processTurn(
      client: GeminiClient,
      config: Config,
      model: string,
      parts: Part[],
      sessionId: string,
      res: express.Response,
      chatId: string,
      historyManager: HistoryManager,
    ) {
      const stream = await client
        .getChat()
        .sendMessageStream(
          { model },
          parts,
          sessionId,
          new AbortController().signal,
        );

      const toolCalls: FunctionCall[] = [];
      let fullResponseText = '';
      let fullThoughts = '';

      for await (const event of stream) {
        let type = 'unknown';
        let data: unknown = {};

        if ('type' in event) {
          type = event.type;
          data = event;
        }

        res.write(`event: ${type}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);

        if (
          event.type === 'chunk' &&
          event.value.candidates?.[0]?.content?.parts
        ) {
          const parts = event.value.candidates[0].content.parts;
          const calls = parts
            .filter((p: unknown) => (p as Part).functionCall)
            .map((p: unknown) => (p as Part).functionCall as FunctionCall);
          toolCalls.push(...calls);

          for (const part of parts) {
            if (part.thought) fullThoughts += part.text;
            if (part.text && !part.thought) fullResponseText += part.text;
          }
        }
      }

      res.write(`event: debug\n`);
      res.write(
        `data: ${JSON.stringify({ msg: `Stream finished. Tool calls detected: ${toolCalls.length}` })}\n\n`,
      );

      if (fullResponseText || fullThoughts) {
        await historyManager.addMessage(chatId, {
          role: 'model',
          text: fullResponseText,
          thoughts: fullThoughts,
          timestamp: Date.now(),
        });
      }

      if (toolCalls.length > 0) {
        const toolRegistry = config.getToolRegistry();
        const functionResponses = await Promise.all(
          toolCalls.map(async (call) => {
            const toolName = call.name!;
            try {
              const tool = toolRegistry.getTool(toolName);
              if (!tool) {
                throw new Error(`Tool ${toolName} not found`);
              }

              // Emit tool_start event
              res.write(`event: tool_start\n`);
              res.write(
                `data: ${JSON.stringify({ toolName, args: call.args, chatId })}\n\n`,
              );

              if (
                toolName === 'preview_site' &&
                call.args &&
                typeof call.args === 'object'
              ) {
                const args = call.args as { path?: string; url?: string };
                let previewUrl = '';
                if (args.url) {
                  previewUrl = args.url;
                } else if (args.path) {
                  const cleanPath = args.path.startsWith('/')
                    ? args.path
                    : `/${args.path}`;
                  previewUrl = `/preview/${chatId}${cleanPath}`;
                }

                if (previewUrl) {
                  res.write(`event: preview\n`);
                  res.write(`data: ${JSON.stringify({ url: previewUrl })}\n\n`);
                }
              }

              const result = await tool.buildAndExecute(
                call.args as Record<string, unknown>,
                new AbortController().signal,
              );

              // Emit tool_end event (optional, but good for clearing status)
              res.write(`event: tool_end\n`);
              res.write(
                `data: ${JSON.stringify({ toolName, result, chatId, args: call.args })}\n\n`,
              );

              return {
                functionResponse: {
                  name: toolName,
                  response: { name: toolName, content: result },
                },
              };
            } catch (error) {
              res.write(`event: tool_error\n`);
              res.write(
                `data: ${JSON.stringify({ toolName, error: String(error), chatId, args: call.args })}\n\n`,
              );
              return {
                functionResponse: {
                  name: toolName,
                  response: {
                    name: toolName,
                    content: { error: String(error) },
                  },
                },
              };
            }
          }),
        );

        await processTurn(
          client,
          config,
          model,
          functionResponses,
          sessionId,
          res,
          chatId,
          historyManager,
        );
      }
    }

    // Serve static files
    try {
      // Resolve the path to the web package
      // We assume the web package is installed as a dependency or workspace
      // If not found (e.g. dev), we might fallback or warn
      let webPath = '';
      try {
        const webPackageJson = require.resolve(
          '@google/gemini-actus-web/package.json',
        );
        webPath = path.dirname(webPackageJson);
      } catch {
        debugLogger.warn(
          'Could not find @google/gemini-actus-web package. Serving only API.',
        );
      }

      if (webPath) {
        const distPath = path.join(webPath, 'dist');
        app.use(express.static(distPath));

        // Fallback to index.html for SPA routing
        app.get(/.*/, (req, res) => {
          res.sendFile(path.join(distPath, 'index.html'));
        });
        debugLogger.log(`Serving Web UI from ${distPath}`);
      }
      server.listen(port, () => {
        debugLogger.log(
          `Gemini Actus Web UI running at http://localhost:${port}`,
        );
      });

      // Keep process alive
      await new Promise(() => {});
    } catch (error) {
      debugLogger.error('Error setting up static file serving:', error);
    }
  },
};

// Exported for testing
export { setupFileSystemRoutes } from './web-routes.js';
