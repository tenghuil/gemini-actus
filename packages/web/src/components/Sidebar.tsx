/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import styles from './Sidebar.module.css';
import { Plus, Menu, Settings } from 'lucide-react';
import type { HistoryItem } from '../hooks/useChat';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  history: HistoryItem[];
  currentChatId: string | null;
  onLoadChat: (id: string) => void;
}

export default function Sidebar({
  isOpen,
  onToggle,
  onNewChat,
  history,
  currentChatId,
  onLoadChat,
}: SidebarProps) {
  if (!isOpen) return null; // Or keep it mounted but hidden if we want animation, but typically conditional render for "closed" state in parent or CSS transform

  return (
    <aside className={`${styles.sidebar} ${!isOpen ? styles.closed : ''}`}>
      <div className={styles.header}>
        <button onClick={onToggle} className={styles.menuBtn}>
          <Menu size={24} />
        </button>
      </div>

      <button onClick={onNewChat} className={styles.newChatBtn}>
        <Plus size={20} />
        <span>New chat</span>
      </button>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Recent</div>
        {history.map((item) => (
          <div
            key={item.id}
            className={`${styles.item} ${currentChatId === item.id ? styles.active : ''}`}
            onClick={() => onLoadChat(item.id)}
          >
            {item.title}
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <div className={styles.item}>
          <Settings
            size={18}
            style={{
              marginRight: 8,
              display: 'inline-block',
              verticalAlign: 'middle',
            }}
          />
          <span>Settings</span>
        </div>
      </div>
    </aside>
  );
}
