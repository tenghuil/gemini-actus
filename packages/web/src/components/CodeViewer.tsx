/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
// eslint-disable-next-line import/no-internal-modules
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeViewerProps {
  content: string;
  language?: string;
}

const CodeViewer: React.FC<CodeViewerProps> = ({
  content,
  language = 'typescript',
}) => (
  <div style={{ height: '100%', overflow: 'auto', fontSize: '14px' }}>
    <SyntaxHighlighter
      language={language}
      style={vscDarkPlus}
      customStyle={{ margin: 0, height: '100%' }}
      showLineNumbers={true}
    >
      {content}
    </SyntaxHighlighter>
  </div>
);

export default CodeViewer;
