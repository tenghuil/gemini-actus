/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import styles from './ThinkingAccordion.module.css';
import { Sparkles, ChevronDown } from 'lucide-react';
import { useState } from 'react';

interface ThinkingAccordionProps {
  content: string;
}

export default function ThinkingAccordion({ content }: ThinkingAccordionProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={styles.container}>
      <button className={styles.header} onClick={() => setIsOpen(!isOpen)}>
        <Sparkles size={16} className={styles.icon} />
        <span>Show thinking</span>
        <ChevronDown
          size={14}
          className={`${styles.chevron} ${isOpen ? styles.expanded : ''}`}
        />
      </button>
      {isOpen && (
        <div className={styles.content}>
          <pre className={styles.pre}>{content}</pre>
        </div>
      )}
    </div>
  );
}
