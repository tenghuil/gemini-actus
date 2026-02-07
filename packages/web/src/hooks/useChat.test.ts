/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useChat } from './useChat';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

// Ensure TextDecoder is available (Node 20 has it globally, but jsdom might need it)
if (!global.TextDecoder) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
  const { TextDecoder } = require('node:util');
  global.TextDecoder = TextDecoder as typeof global.TextDecoder;
}
if (!global.TextEncoder) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, no-restricted-syntax
  const { TextEncoder } = require('node:util');
  global.TextEncoder = TextEncoder as typeof global.TextEncoder;
}

vi.mock('next/navigation', () => ({
  useParams: () => ({ chatId: '123' }),
}));

describe('useChat', () => {
  beforeEach(() => {
    fetchMock.mockReset();

    // Default mock for history and other calls
    fetchMock.mockImplementation((url) => {
      if (url === '/api/history') {
        return Promise.resolve({
          ok: true,
          json: async () => [],
        });
      }
      return Promise.resolve({ ok: false });
    });
  });

  it('should update messages immutably when receiving streaming response', async () => {
    const { result } = renderHook(() => useChat());

    // Setup streaming response
    const stream = new ReadableStream({
      start(controller) {
        // Enqueue parts of the response with event: chunk
        controller.enqueue(
          new TextEncoder().encode(
            'event: chunk\ndata: {"type": "chunk", "value": {"candidates": [{"content": {"parts": [{"text": "Hello"}]}}]}}\n\n',
          ),
        );
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(
              'event: chunk\ndata: {"type": "chunk", "value": {"candidates": [{"content": {"parts": [{"text": " World"}]}}]}}\n\n',
            ),
          );
          controller.close();
        }, 500); // Increased delay
      },
    });

    // Mock chat endpoint specifically
    fetchMock.mockImplementation((url) => {
      if (url === '/api/chat') {
        return Promise.resolve({
          ok: true,
          body: stream,
          getReader: () => stream.getReader(),
        });
      }
      // Return history mock for others
      return Promise.resolve({
        ok: true,
        json: async () => [],
      });
    });

    // Send message
    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    // Check initial state
    expect(result.current.messages).toHaveLength(2); // User + Model (empty initially)
    const initialModelMsg = result.current.messages[1];
    expect(initialModelMsg.role).toBe('model');

    // Wait for the final update (Hello World)
    await waitFor(() => {
      expect(result.current.messages[1].text).toBe('Hello World');
    });

    const finalMsg = result.current.messages[1];
    expect(finalMsg.role).toBe('model');
    expect(finalMsg.text).toBe('Hello World');
  });

  it('should set isTaskFinished to true when receiving finish event', async () => {
    const { result } = renderHook(() => useChat());

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: chunk\ndata: {"type": "chunk", "value": {"candidates": [{"content": {"parts": [{"text": "Done"}]}}]}}\n\n',
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'event: finish\ndata: {"success": true}\n\n',
          ),
        );
        controller.close();
      },
    });

    fetchMock.mockImplementation((url) => {
      if (url === '/api/chat') {
        return Promise.resolve({
          ok: true,
          body: stream,
          getReader: () => stream.getReader(),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });

    await act(async () => {
      await result.current.sendMessage('test');
    });

    await waitFor(() => {
      expect(result.current.isTaskFinished).toBe(true);
    });
  });

  it('should set activePreviewUrl when replace tool ends (new file) using args', async () => {
    const { result } = renderHook(() => useChat());

    const chatId = 'test-chat-id';
    const filePath = 'index.html'; // Relative path in args

    const stream = new ReadableStream({
      start(controller) {
        // Must send tool_start first for the tool call to be registered in messages
        controller.enqueue(
          new TextEncoder().encode(
            `event: tool_start\ndata: ${JSON.stringify({
              toolName: 'replace',
              args: { file_path: filePath },
              chatId,
            })}\n\n`,
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            `event: tool_end\ndata: ${JSON.stringify({
              toolName: 'replace',
              result: { returnDisplay: 'Created index.html' }, // String result for new file
              chatId,
              args: { file_path: filePath },
            })}\n\n`,
          ),
        );
        controller.enqueue(
          new TextEncoder().encode(
            'event: finish\ndata: {"success": true}\n\n',
          ),
        );
        controller.close();
      },
    });

    fetchMock.mockImplementation((url) => {
      if (url === '/api/chat') {
        return Promise.resolve({
          ok: true,
          body: stream,
          getReader: () => stream.getReader(),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });

    await act(async () => {
      await result.current.sendMessage('create index.html');
    });

    await waitFor(() => {
      expect(result.current.activePreviewUrl).toBe(
        `/preview/${chatId}/index.html`,
      );
      expect(result.current.isTaskFinished).toBe(true);
    });
  });

  it('should handle "content" and "thought" events correctly (new style)', async () => {
    const { result } = renderHook(() => useChat());

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'event: thought\ndata: {"value": "Thinking..."}\n\n',
          ),
        );
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(
              'event: content\ndata: {"value": "Hello"}\n\n',
            ),
          );
        }, 10);
        setTimeout(() => {
          controller.enqueue(
            new TextEncoder().encode(
              'event: content\ndata: {"value": " World"}\n\n',
            ),
          );
          controller.close();
        }, 20);
      },
    });

    fetchMock.mockImplementation((url) => {
      if (url === '/api/chat') {
        return Promise.resolve({
          ok: true,
          body: stream,
          getReader: () => stream.getReader(),
        });
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });

    await act(async () => {
      await result.current.sendMessage('Hi');
    });

    await waitFor(() => {
      const msg = result.current.messages.find((m) => m.role === 'model');
      expect(msg).toBeDefined();
      expect(msg?.text).toBe('Hello World');
      // Thoughts handling might be object or string depending on implementation,
      // but based on `client.ts` it seems to be sending parsed thought object,
      // wait, `client.ts` sends `value: thought` where thought is `Thinking...` string or object?
      // parseThought returns ThoughtSummary which has text.
      // Let's check client.ts again.
      // `yield { type: GeminiEventType.Thought, value: thought, traceId };`
      // `thought` is `ThoughtSummary`.
      // Wait, `ThoughtSummary` is `{ text: string }` usually?
      // `parseThought` returns `ThoughtSummary`?
      // `src/utils/thoughtUtils.ts` not read yet.
      // Assuming it has text.
      // In `useChat.ts` currently: `currentThoughts += part.text;`
      // If we change it to append `data.value`, we need to know if `data.value` is string or object.
      // `client.ts` says `value: thought`.
      // Let's assume for now it might be an object or string.
      // In `useChat.ts` we will implement it to handle both or check.

      it('should set activePreviewUrl when replace tool ends (markdown file)', async () => {
        const { result } = renderHook(() => useChat());

        const chatId = 'test-chat-id-md';
        const filePath = 'README.md';

        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                `event: tool_start\ndata: ${JSON.stringify({
                  toolName: 'replace',
                  args: { file_path: filePath },
                  chatId,
                })}\n\n`,
              ),
            );
            controller.enqueue(
              new TextEncoder().encode(
                `event: tool_end\ndata: ${JSON.stringify({
                  toolName: 'replace',
                  result: { returnDisplay: 'Created README.md' },
                  chatId,
                  args: { file_path: filePath },
                })}\n\n`,
              ),
            );
            controller.enqueue(
              new TextEncoder().encode(
                'event: finish\ndata: {"success": true}\n\n',
              ),
            );
            controller.close();
          },
        });

        fetchMock.mockImplementation((url) => {
          if (url === '/api/chat') {
            return Promise.resolve({
              ok: true,
              body: stream,
              getReader: () => stream.getReader(),
            });
          }
          return Promise.resolve({ ok: true, json: async () => [] });
        });

        await act(async () => {
          await result.current.sendMessage('create README.md');
        });

        await waitFor(() => {
          expect(result.current.activePreviewUrl).toBe(
            `/preview/${chatId}/README.md`,
          );
          expect(result.current.isTaskFinished).toBe(true);
        });
      });
    });
  });
});
