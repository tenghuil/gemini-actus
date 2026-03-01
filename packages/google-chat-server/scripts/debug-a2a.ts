/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer } from 'node:http';
import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  RestTransportFactory,
} from '@a2a-js/sdk/client';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  console.log('Starting Mock Agent Server...');
  const mockAgentServer = createServer((req, res) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    if (url.pathname === '/.well-known/agent-card.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          protocolVersion: '1.0',
          identity: { name: 'Mock Agent' },
          preferredTransport: 'HTTP+JSON',
          url: 'http://localhost:41243/message',
          capabilities: {
            streaming: true,
          },
        }),
      );
    } else if (url.pathname === '/message') {
      console.log('Received message request');
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        console.log('Body:', body);
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson' }); // RestTransport expects application/json usually? No, stream expects text/event-stream or similar?
        // SDK source: _sendStreamingRequest headers Accept text/event-stream
        // And check Content-Type starts with text/event-stream
        // So I must return text/event-stream
      });
    } else if (url.pathname === '/v1/message:stream') {
      // RestTransport implementation uses /v1/message:stream appended to endpoint
      // My endpoint is http://localhost:41243/message
      // So it will request http://localhost:41243/message/v1/message:stream
      // Wait, RestTransport constructor: this.endpoint = options.endpoint.replace(/\/+$/, "");
      // _sendStreamingRequest: const url = `${this.endpoint}${path}`;
      // path is /v1/message:stream
      // So I need to handle /message/v1/message:stream if my url is .../message
      // OR I should set url to http://localhost:41243
    } else {
      // Let's log 404s
      // console.log('404:', url.pathname);
      // We need to handle the specific path RestTransport uses.
      // If I set url to http://localhost:41243, it will request http://localhost:41243/v1/message:stream

      if (url.pathname === '/v1/message:stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const responseMessage = {
          kind: 'message',
          role: 'model',
          messageId: 'response-1',
          parts: [{ kind: 'text', text: 'Hello from Mock Agent!' }],
        };
        // StreamResponse wrapping?
        // _processSseEventData parses JSON.
        // And expects StreamResponse format?
        // SDK: const protoResponse = StreamResponse.fromJSON(response);
        // So I need to return StreamResponse JSON.
        const streamResponse = {
          result: responseMessage,
        };
        res.write(`data: ${JSON.stringify(streamResponse)}\n\n`);
        res.end();
      } else {
        res.writeHead(404);
        res.end();
      }
    }
  });
  mockAgentServer.listen(41243);

  await new Promise((r) => setTimeout(r, 1000));

  try {
    console.log('Connecting to Mock Agent...');
    const agentCardUrl = 'http://localhost:41243/.well-known/agent-card.json';
    const resolver = new DefaultAgentCardResolver({ fetchImpl: fetch });
    const options = ClientFactoryOptions.createFrom(
      ClientFactoryOptions.default,
      {
        transports: [new RestTransportFactory({ fetchImpl: fetch })],
        cardResolver: resolver,
      },
    );

    // Force REST
    options.transports = options.transports.filter(
      (t) => t instanceof RestTransportFactory,
    );

    const factory = new ClientFactory(options);
    const client = await factory.createFromUrl(agentCardUrl, '');
    console.log('Client created:', JSON.stringify(client, null, 2));

    const stream = client.sendMessageStream({
      message: {
        kind: 'message',
        role: 'user',
        messageId: uuidv4(),
        parts: [{ kind: 'text', text: 'Hello' }],
      },
      configuration: { blocking: true },
    });

    for await (const chunk of stream) {
      console.log('Chunk:', JSON.stringify(chunk));
    }
    console.log('Done.');
  } catch (e) {
    console.error('Error:', e);
  } finally {
    mockAgentServer.close();
  }
}

main();
