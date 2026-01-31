/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import styles from './ChatArea.module.css';
import type { Message } from '../hooks/useChat';
import { Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import ThinkingAccordion from './ThinkingAccordion';
import { useEffect, useRef } from 'react';

interface ChatAreaProps {
  messages: Message[];
}

export default function ChatArea({ messages }: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]); // Scroll on new messages

  if (messages.length === 0) {
    return (
      <div className={`${styles.chatArea} ${styles.landing}`}>
        <div className={styles.emptyState}>
          <h1 className={styles.title}>Hello, Tenghui</h1>
          <p className={styles.subtitle}>How can I help you today?</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.chatArea}>
      <div className={styles.messagesList}>
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`${styles.messageRow} ${msg.role === 'user' ? styles.userRow : styles.modelRow}`}
          >
            {msg.role === 'model' && (
              <div className={`${styles.avatar} ${styles.modelAvatar}`}>
                <Sparkles size={20} />
              </div>
            )}

            <div
              className={styles.messageContent}
              style={{ flex: 1, overflow: 'hidden' }}
            >
              {msg.thoughts && <ThinkingAccordion content={msg.thoughts} />}

              {msg.toolCalls && msg.toolCalls.length > 0 && (
                <div
                  style={{
                    marginBottom: '8px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '4px',
                  }}
                >
                  {msg.toolCalls.map((tool, idx) => (
                    <div
                      key={idx}
                      style={{
                        fontSize: '12px',
                        color: tool.status === 'error' ? '#f44336' : '#aaa',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      {tool.status === 'running' && (
                        <span className={styles.spinner}>⏳</span>
                      )}
                      {tool.status === 'completed' && <span>✅</span>}
                      {tool.status === 'error' && <span>❌</span>}
                      <span>
                        {tool.status === 'running'
                          ? 'Running'
                          : tool.status === 'completed'
                            ? 'Finished'
                            : 'Failed'}{' '}
                        <b>{tool.toolName}</b>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {msg.text && (
                <div
                  className={`${styles.bubble} ${msg.role === 'user' ? styles.userBubble : styles.modelBubble}`}
                >
                  {msg.role === 'model' ? (
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                  ) : (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
