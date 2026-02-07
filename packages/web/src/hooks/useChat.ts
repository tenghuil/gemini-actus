/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useCallback, useEffect } from 'react';

export interface Message {
  role: 'user' | 'model' | 'error';
  text: string;
  thoughts?: string;
  timestamp?: number;
  toolCalls?: Array<{
    toolName: string;
    args: unknown;
    status: 'running' | 'completed' | 'error';
    result?: unknown;
    error?: string;
  }>;
}

export interface HistoryItem {
  id: string;
  title: string;
  lastModified: number;
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);
  const [lastTouchedFile, setLastTouchedFile] = useState<string | null>(null);
  const [isTaskFinished, setIsTaskFinished] = useState(false);

  // Ref for abort controller if needed
  // const abortControllerRef = useRef<AbortController | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/history');
      if (res.ok) {
        const data = await res.json();
        setHistory(data);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch history', e);
    }
  }, []);

  const loadChat = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/history/${id}`);
      if (res.ok) {
        const chat = await res.json();
        setMessages(chat.messages);
        setCurrentChatId(chat.id);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Failed to load chat', e);
    }
  }, []);

  const startNewChat = useCallback(() => {
    setMessages([]);
    setCurrentChatId(null);
    setIsTaskFinished(false);
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      setIsLoading(true);
      setIsTaskFinished(false);
      setMessages((prev) => [...prev, { role: 'user', text }]);
      setInput('');

      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text, chatId: currentChatId }),
        });

        if (!response.body) throw new Error('No response body');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let currentResponse = '';
        let currentThoughts = '';

        setMessages((prev) => [
          ...prev,
          { role: 'model', text: '', thoughts: '' },
        ]);

        while (true) {
          const { done, value } = await reader.read();
          const chunk = value ? decoder.decode(value, { stream: true }) : '';
          buffer += chunk;

          const parts = buffer.split('\n\n');
          // If there's more data coming, keep the last part in buffer.
          // If done, we can process everything.
          if (!done) {
            buffer = parts.pop() || '';
          } else {
            buffer = '';
          }

          for (const block of parts) {
            if (!block.trim()) continue;

            const lines = block.split('\n');

            // Check if it's a standard SSE event block
            const eventLine = lines.find((l) => l.trim().startsWith('event: '));
            const dataLine = lines.find((l) => l.trim().startsWith('data: '));

            if (eventLine && dataLine) {
              const eventType = eventLine
                .slice(eventLine.indexOf(':') + 1)
                .trim();
              try {
                const dataRaw = dataLine
                  .slice(dataLine.indexOf(':') + 1)
                  .trim();
                const data = JSON.parse(dataRaw);

                if (eventType === 'debug') {
                  // eslint-disable-next-line no-console
                  console.log('Server Debug:', data.msg);
                } else if (eventType === 'chat_id') {
                  if (data.chatId) {
                    setCurrentChatId(data.chatId);
                    void fetchHistory();
                  }
                } else if (eventType === 'preview') {
                  setActivePreviewUrl(data.url);
                } else if (eventType === 'finish') {
                  setIsTaskFinished(true);
                } else if (eventType === 'content') {
                  // Handle content event (new backend style)
                  const text =
                    typeof data.value === 'string'
                      ? data.value
                      : data.value?.text || '';
                  currentResponse += text;

                  const textSnapshot = currentResponse;
                  const thoughtsSnapshot = currentThoughts;

                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastMsgIndex = newMessages.length - 1;
                    const lastMsg = newMessages[lastMsgIndex];

                    if (lastMsg && lastMsg.role === 'model') {
                      newMessages[lastMsgIndex] = {
                        ...lastMsg,
                        text: textSnapshot,
                        thoughts: thoughtsSnapshot,
                      };
                    } else {
                      return [
                        ...prev,
                        {
                          role: 'model',
                          text: textSnapshot,
                          thoughts: thoughtsSnapshot,
                        },
                      ];
                    }
                    return newMessages;
                  });
                } else if (eventType === 'thought') {
                  // Handle thought event (new backend style)
                  const text =
                    typeof data.value === 'string'
                      ? data.value
                      : data.value?.text || '';
                  currentThoughts += text;

                  const textSnapshot = currentResponse;
                  const thoughtsSnapshot = currentThoughts;

                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastMsgIndex = newMessages.length - 1;
                    const lastMsg = newMessages[lastMsgIndex];

                    if (lastMsg && lastMsg.role === 'model') {
                      newMessages[lastMsgIndex] = {
                        ...lastMsg,
                        text: textSnapshot,
                        thoughts: thoughtsSnapshot,
                      };
                    } else {
                      return [
                        ...prev,
                        {
                          role: 'model',
                          text: textSnapshot,
                          thoughts: thoughtsSnapshot,
                        },
                      ];
                    }
                    return newMessages;
                  });
                } else if (eventType === 'tool_start') {
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastMsgIndex = newMessages.length - 1;
                    const lastMsg = newMessages[lastMsgIndex];

                    // Avoid duplicate events if possible
                    if (lastMsg && lastMsg.role === 'model') {
                      // Create a copy of the last message
                      const newLastMsg = {
                        ...lastMsg,
                        toolCalls: lastMsg.toolCalls
                          ? [...lastMsg.toolCalls]
                          : [],
                      };

                      // Check if we already have this tool call running
                      const existingCallIndex = newLastMsg.toolCalls.findIndex(
                        (tc) =>
                          tc.toolName === data.toolName &&
                          JSON.stringify(tc.args) === JSON.stringify(data.args),
                      );

                      if (existingCallIndex === -1) {
                        newLastMsg.toolCalls.push({
                          toolName: data.toolName,
                          args: data.args,
                          status: 'running',
                        });
                        newMessages[lastMsgIndex] = newLastMsg;
                      }
                    } else {
                      return [
                        ...prev,
                        {
                          role: 'model',
                          text: '',
                          toolCalls: [
                            {
                              toolName: data.toolName,
                              args: data.args,
                              status: 'running',
                            },
                          ],
                        },
                      ];
                    }
                    return newMessages;
                  });
                } else if (eventType === 'tool_end') {
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastMsgIndex = newMessages.length - 1;
                    const lastMsg = newMessages[lastMsgIndex];

                    if (
                      lastMsg &&
                      lastMsg.role === 'model' &&
                      lastMsg.toolCalls
                    ) {
                      const callIndex = lastMsg.toolCalls.findIndex(
                        (c) =>
                          c.toolName === data.toolName &&
                          c.status === 'running',
                      );
                      if (callIndex !== -1) {
                        const newLastMsg = {
                          ...lastMsg,
                          toolCalls: [...lastMsg.toolCalls],
                        };
                        newLastMsg.toolCalls[callIndex] = {
                          ...newLastMsg.toolCalls[callIndex],
                          status: 'completed',
                          result: data.result,
                        };
                        newMessages[lastMsgIndex] = newLastMsg;

                        // Support automatic preview/canvas opening
                        const result = data.result;
                        // const toolName = data.toolName; // Unused
                        const args = data.args;
                        const chatId = data.chatId;

                        // Try to get filePath from result or args
                        let filePath = result?.returnDisplay?.filePath;
                        if (!filePath && args?.file_path) {
                          filePath = args.file_path;
                        } else if (!filePath && args?.path) {
                          filePath = args.path;
                        }

                        if (filePath) {
                          setLastTouchedFile(filePath);

                          // If it's an HTML or Markdown file, also set as preview URL automatically
                          if (
                            (filePath.endsWith('.html') ||
                              filePath.endsWith('.md')) &&
                            chatId
                          ) {
                            // Extract relative path from workspace root
                            const parts = filePath.split('.workspace/');
                            if (parts.length > 1) {
                              const relativePath = parts[1]
                                .split('/')
                                .slice(1)
                                .join('/');
                              setActivePreviewUrl(
                                `/preview/${chatId}/${relativePath}`,
                              );
                            } else if (!filePath.startsWith('/')) {
                              // If it's already a relative path
                              setActivePreviewUrl(
                                `/preview/${chatId}/${filePath}`,
                              );
                            }
                          }
                        }
                      }
                    }
                    return newMessages;
                  });
                } else if (eventType === 'tool_error') {
                  setMessages((prev) => {
                    const newMessages = [...prev];
                    const lastMsgIndex = newMessages.length - 1;
                    const lastMsg = newMessages[lastMsgIndex];

                    if (
                      lastMsg &&
                      lastMsg.role === 'model' &&
                      lastMsg.toolCalls
                    ) {
                      const callIndex = lastMsg.toolCalls.findIndex(
                        (c) =>
                          c.toolName === data.toolName &&
                          c.status === 'running',
                      );
                      if (callIndex !== -1) {
                        const newLastMsg = {
                          ...lastMsg,
                          toolCalls: [...lastMsg.toolCalls],
                        };
                        newLastMsg.toolCalls[callIndex] = {
                          ...newLastMsg.toolCalls[callIndex],
                          status: 'error',
                          error: data.error,
                        };
                        newMessages[lastMsgIndex] = newLastMsg;
                      }
                    }
                    return newMessages;
                  });
                } else if (eventType === 'chunk') {
                  const candidates =
                    data.value?.candidates?.[0]?.content?.parts;
                  if (candidates) {
                    for (const part of candidates) {
                      if (part.thought) {
                        currentThoughts += part.text;
                      } else if (part.text) {
                        currentResponse += part.text;
                      }
                    }

                    const textSnapshot = currentResponse;
                    const thoughtsSnapshot = currentThoughts;

                    setMessages((prev) => {
                      const newMessages = [...prev];
                      const lastMsgIndex = newMessages.length - 1;
                      const lastMsg = newMessages[lastMsgIndex];

                      if (lastMsg && lastMsg.role === 'model') {
                        newMessages[lastMsgIndex] = {
                          ...lastMsg,
                          text: textSnapshot,
                          thoughts: thoughtsSnapshot,
                        };
                      } else {
                        return [
                          ...prev,
                          {
                            role: 'model',
                            text: textSnapshot,
                            thoughts: thoughtsSnapshot,
                          },
                        ];
                      }
                      return newMessages;
                    });
                  }
                } else if (eventType === 'response') {
                  // Backward compatibility if needed, or if server sends 'response' event
                }
              } catch (e) {
                // eslint-disable-next-line no-console
                console.error('Error parsing SSE data:', e, dataLine);
              }
              continue; // Handled as event
            }

            // Fallback for standard data-only SSE (like chat generation)
            for (const line of lines) {
              if (line.trim().startsWith('data: ')) {
                try {
                  const dataRaw = line.slice(line.indexOf(':') + 1).trim();
                  const data = JSON.parse(dataRaw);

                  if (data.chatId) {
                    setCurrentChatId(data.chatId);
                    void fetchHistory();
                    continue;
                  }

                  const candidates =
                    data.value?.candidates?.[0]?.content?.parts;
                  if (candidates) {
                    for (const part of candidates) {
                      if (part.thought) {
                        currentThoughts += part.text;
                      } else if (part.text) {
                        currentResponse += part.text;
                      }
                    }

                    // Capture current state values to avoid closure stale/future value issues
                    const textSnapshot = currentResponse;
                    const thoughtsSnapshot = currentThoughts;

                    setMessages((prev) => {
                      const newMessages = [...prev];
                      const lastMsgIndex = newMessages.length - 1;
                      const lastMsg = newMessages[lastMsgIndex];

                      if (lastMsg && lastMsg.role === 'model') {
                        newMessages[lastMsgIndex] = {
                          ...lastMsg,
                          text: textSnapshot,
                          thoughts: thoughtsSnapshot,
                        };
                      } else {
                        // Should not happen if we initialized with empty model msg, but just in case
                        return [
                          ...prev,
                          {
                            role: 'model',
                            text: textSnapshot,
                            thoughts: thoughtsSnapshot,
                          },
                        ];
                      }
                      return newMessages;
                    });
                  }
                } catch (e) {
                  // eslint-disable-next-line no-console
                  console.error('Error parsing data-only SSE:', e);
                }
              }
            }
          }
          if (done) break;
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Fetch error:', error);
        if (error instanceof Error && error.name !== 'AbortError') {
          setMessages((prev) => [
            ...prev,
            { role: 'error', text: `Error: ${error.message}` },
          ]);
        }
      } finally {
        setIsLoading(false);
      }
    },
    [currentChatId, fetchHistory, isLoading],
  );

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  return {
    messages,
    input,
    setInput,
    isLoading,
    sendMessage,
    history,
    fetchHistory,
    loadChat,
    startNewChat,
    currentChatId,
    activePreviewUrl,
    setActivePreviewUrl,
    lastTouchedFile,
    setLastTouchedFile,
    isTaskFinished,
  };
}
