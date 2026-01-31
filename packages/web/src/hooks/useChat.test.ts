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
});
