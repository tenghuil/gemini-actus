/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import styles from './InputArea.module.css';
import { Plus, ArrowUp } from 'lucide-react';
import { useRef, useEffect } from 'react';

interface InputAreaProps {
  input: string;
  setInput: (val: string) => void;
  onSend: () => void;
  isLoading: boolean;
}

export default function InputArea({
  input,
  setInput,
  onSend,
  isLoading,
}: InputAreaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  };

  useEffect(() => {
    adjustHeight();
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.wrapper}>
        <div className={styles.inputBox}>
          <button className={styles.iconBtn}>
            <Plus size={20} />
          </button>

          <textarea
            ref={textareaRef}
            className={styles.textarea}
            placeholder="Enter a prompt for Gemini"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={1}
          />

          <button
            className={styles.iconBtn}
            onClick={onSend}
            disabled={isLoading || !input.trim()}
          >
            <ArrowUp size={20} />
          </button>
        </div>
        <div className={styles.disclaimer}>
          Gemini may display inaccurate info, including about people, so
          double-check its responses.
        </div>
      </div>
    </div>
  );
}
