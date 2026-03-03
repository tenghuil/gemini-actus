/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ClientFactory,
  ClientFactoryOptions,
  DefaultAgentCardResolver,
  RestTransportFactory,
  JsonRpcTransportFactory,
} from '@a2a-js/sdk/client';
import { v4 as uuidv4 } from 'uuid';

async function main() {
  const port = '41242';
  const agentCardUrl = `http://localhost:${port}/.well-known/agent-card.json`;
  const resolver = new DefaultAgentCardResolver({ fetchImpl: fetch });
  const options = ClientFactoryOptions.createFrom(
    ClientFactoryOptions.default,
    {
      transports: [
        new RestTransportFactory({ fetchImpl: fetch }),
        new JsonRpcTransportFactory({ fetchImpl: fetch }),
      ],
      cardResolver: resolver,
    },
  );

  const factory = new ClientFactory(options);
  const client = await factory.createFromUrl(agentCardUrl, '');

  const sessionId = 'test-session-' + Date.now();
  await fetch(agentCardUrl.replace('/.well-known/agent-card.json', '/tasks'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: sessionId, contextId: sessionId }),
  });

  const stream = client.sendMessageStream({
    message: {
      kind: 'message',
      role: 'user',
      taskId: sessionId,
      messageId: uuidv4(),
      contextId: sessionId,
      parts: [
        {
          kind: 'text',
          text: 'Send an email to tenghuil@google.com with title test and body test',
        },
      ],
    },
    configuration: { blocking: true },
  });

  for await (const chunk of stream) {
    console.log(JSON.stringify(chunk, null, 2));
  }
}

main().catch(console.error);
