/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

'use client';

import { useState, useEffect } from 'react';
import styles from './page.module.css';
import Sidebar from '../components/Sidebar';
import ChatArea from '../components/ChatArea';
import InputArea from '../components/InputArea';
import { useChat } from '../hooks/useChat';
import { Menu, ChevronDown } from 'lucide-react';
import Canvas from '../components/Canvas';

export default function Home() {
  const {
    messages,
    input,
    setInput,
    sendMessage,
    isLoading,
    history,
    currentChatId,
    loadChat,
    startNewChat,
    fetchHistory,
    activePreviewUrl,
    setActivePreviewUrl,
  } = useChat();

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);

  // Initial fetch
  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  // Auto-open Canvas when a preview is active
  useEffect(() => {
    if (activePreviewUrl) {
      setIsCanvasOpen(true);
    }
  }, [activePreviewUrl]);

  // Resize logic
  const [canvasWidth, setCanvasWidth] = useState(600);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = window.innerWidth - e.clientX;
      // Min width 300px, Max width 80% of screen
      if (newWidth > 300 && newWidth < window.innerWidth * 0.8) {
        setCanvasWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  return (
    <div className={styles.mainContainer}>
      <Sidebar
        isOpen={isSidebarOpen}
        onToggle={() => setIsSidebarOpen(false)}
        onNewChat={startNewChat}
        history={history}
        currentChatId={currentChatId}
        onLoadChat={loadChat}
      />

      <main
        className={`${styles.contentWrapper} ${!isSidebarOpen ? styles.expanded : ''}`}
      >
        <div className={styles.topBar}>
          {!isSidebarOpen && (
            <button
              className={styles.mobileMenuBtn}
              onClick={() => setIsSidebarOpen(true)}
            >
              <Menu size={24} />
            </button>
          )}
          <div
            className={styles.modelSelector}
            style={{ marginLeft: !isSidebarOpen ? 12 : 0 }}
          >
            Gemini <ChevronDown size={14} className={styles.caret} />
          </div>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setIsCanvasOpen(!isCanvasOpen)}
            style={{
              background: isCanvasOpen ? '#e8f0fe' : 'transparent',
              color: isCanvasOpen ? '#1a73e8' : '#5f6368',
              border: '1px solid',
              borderColor: isCanvasOpen ? '#1a73e8' : '#dadce0',
              borderRadius: '8px',
              padding: '6px 12px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginRight: '20px',
              fontSize: '14px',
              fontWeight: 500,
            }}
          >
            Canvas
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            flex: 1,
            height: 'calc(100% - 56px)',
            marginTop: '56px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              flex: 1,
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
            }}
          >
            <ChatArea messages={messages} />

            <InputArea
              input={input}
              setInput={setInput}
              onSend={() => sendMessage(input)}
              isLoading={isLoading}
            />
          </div>
          {isCanvasOpen && (
            <>
              <div
                onMouseDown={() => setIsResizing(true)}
                style={{
                  width: '4px',
                  cursor: 'col-resize',
                  backgroundColor: isResizing ? '#1a73e8' : 'transparent',
                  borderLeft: '1px solid #dadce0',
                  transition: 'background-color 0.2s',
                  zIndex: 10,
                }}
                className={styles.resizeHandle} // Optional class if you want to add hover effects via CSS
              />
              <div
                style={{
                  width: canvasWidth,
                  display: 'flex',
                  flexDirection: 'column',
                  position: 'relative',
                  pointerEvents: isResizing ? 'none' : 'auto', // Prevent iframe from capturing mouse events during drag
                }}
              >
                <Canvas
                  previewUrl={activePreviewUrl}
                  chatId={currentChatId || undefined}
                  onPreviewUrlChange={setActivePreviewUrl}
                />
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
