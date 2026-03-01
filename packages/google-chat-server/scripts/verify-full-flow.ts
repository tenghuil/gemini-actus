/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'node:child_process';

const SERVER_PORT = 8080;
const WS_URL = `ws://localhost:${SERVER_PORT}`;

async function main() {
  console.log('--- Starting Verification Script ---');

  // 1. Start the Google Chat Server
  console.log('1. Starting Google Chat Server...');
  const serverProcess = spawn('npm', ['start'], {
    cwd: process.cwd(),
    stdio: 'pipe',
    shell: true,
  });

  serverProcess.stdout.on('data', async (data) => {
    // console.log(`[Server]: ${data}`);
    if (data.toString().includes('Listening on port')) {
      console.log('   Server started.');

      // 1.5 Start Mock Agent Server (for A2A)
      console.log('1.5 Starting Mock Agent Server on 41242...');
      const { createServer } = await import('node:http');
      const mockAgentServer = createServer((req, res) => {
        const url = new URL(req.url || '', `http://${req.headers.host}`);
        if (url.pathname === '/.well-known/agent-card.json') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              protocolVersion: '1.0',
              identity: { name: 'Mock Agent' },
              preferredTransport: 'HTTP+JSON',
              url: 'http://localhost:41242',
              capabilities: {
                streaming: true,
              },
            }),
          );
        } else if (
          url.pathname === '/v1/message:send' ||
          url.pathname === '/message'
        ) {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                msg: {
                  messageId: 'resp-1',
                  role: 'ROLE_AGENT',
                  content: [{ text: 'Hello from Mock Agent via REST!' }],
                },
              }),
            );
          });
        } else if (url.pathname === '/v1/message:stream') {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            res.writeHead(200, { 'Content-Type': 'text/event-stream' });
            // Construct StreamResponse JSON using Canonical Proto3 JSON for Parts
            // { text: "..." } should be converted to { part: { $case: 'text', value: "..." } } by fromJSON
            const streamResponse = {
              msg: {
                messageId: 'response-1',
                role: 'ROLE_AGENT',
                content: [{ text: 'Hello from Mock Agent!' }],
              },
            };
            res.write(`data: ${JSON.stringify(streamResponse)}\n\n`);
            res.end();
          });
        } else {
          // console.log('Mock Server 404:', url.pathname);
          res.writeHead(404);
          res.end();
        }
      });
      mockAgentServer.listen(41242);

      runTests();
    }
  });

  serverProcess.stderr.on('data', (data) =>
    console.error(`[Server Error]: ${data}`),
  );

  async function runTests() {
    try {
      // Give server a moment to fully init
      await new Promise((r) => setTimeout(r, 1000));

      // 2. Request a pairing code (Simulate Google Chat POST /pair)
      console.log('2. Requesting pairing code (mocking Google Chat)...');

      const pairResponse = await fetch(`${SERVER_URL}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'MESSAGE',
          message: {
            slashCommand: { commandId: '1' }, // Assuming 1 is pair, or we check usage
            text: '/pair',
            thread: { name: 'spaces/AAA/threads/BBB' },
            space: { name: 'spaces/AAA' },
          },
          user: { name: 'users/12345', displayName: 'Test User' },
        }),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pairJson = (await pairResponse.json()) as any;
      console.log('   Response from /pair:', pairJson);

      const pairingCodeMatch = pairJson.text?.match(
        /connect-chat (\d{3}-\d{3})/,
      );
      if (!pairingCodeMatch) {
        throw new Error('Could not find pairing code in response');
      }
      const pairingCode = pairingCodeMatch[1];
      console.log(`   Got pairing code: ${pairingCode}`);

      // 3. Connect the Gateway Client (Local Agent)
      console.log('3. Connecting Gateway Client...');

      const { GatewayClient } = await import(
        '../../google-chat-gateway/dist/client.js'
      );
      const client = new GatewayClient(WS_URL, pairingCode);
      client.connect();

      await new Promise((r) => setTimeout(r, 2000));
      console.log('   Gateway connected.');

      // 4. Send a message from "Google Chat" -> Server -> Agent
      console.log('4. Sending message from Google Chat...');
      const chatResponse = await fetch(`${SERVER_URL}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'MESSAGE',
          message: {
            text: 'Hello Agent, are you there?',
            thread: { name: 'spaces/AAA/threads/BBB' },
            space: { name: 'spaces/AAA' },
          },
          user: { name: 'users/12345', displayName: 'Test User' },
        }),
      });
      console.log('   Chat message sent. Status:', chatResponse.status);

      console.log('5. Waiting for Agent Response...');
      await new Promise((r) => setTimeout(r, 5000));

      console.log('--- Verification Finished (Check logs for success) ---');
      process.exit(0);
    } catch (e) {
      console.error('Test failed:', e);
      process.exit(1);
    } finally {
      serverProcess.kill();
      process.exit(0);
    }
  }
}

main();
