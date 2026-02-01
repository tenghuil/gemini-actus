/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import type React from 'react';
import { RefreshCw, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface PreviewProps {
  url?: string;
  onUrlChange?: (url: string) => void;
}

const Preview: React.FC<PreviewProps> = ({
  url = '/preview/index.html',
  onUrlChange,
}) => {
  const [key, setKey] = useState(0);
  const [isMarkdown, setIsMarkdown] = useState(false);
  const [mdContent, setMdContent] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const isMd = url.toLowerCase().endsWith('.md');
    setIsMarkdown(isMd);

    if (isMd) {
      void fetchMarkdownContent(url);
    }
  }, [url]);

  const fetchMarkdownContent = async (mdUrl: string) => {
    setIsLoading(true);
    try {
      // The url looks like /preview/chatId/path/to/file.md
      // We need to fetch the content. Our web-routes serves files via /preview
      const res = await fetch(mdUrl);
      if (res.ok) {
        const text = await res.text();
        setMdContent(text);
      } else {
        setMdContent('# Error loading markdown');
      }
    } catch (error) {
      setMdContent('# Error: ' + String(error));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = () => {
    if (isMarkdown) {
      void fetchMarkdownContent(url);
    } else {
      setKey((prev) => prev + 1);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#fff',
        color: '#333',
      }}
    >
      <div
        style={{
          padding: '8px',
          borderBottom: '1px solid #eee',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: '#f5f5f5',
        }}
      >
        <button
          onClick={handleRefresh}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '4px',
            color: '#666',
          }}
          title="Refresh Preview"
        >
          <RefreshCw size={16} />
        </button>
        <input
          type="text"
          value={url}
          onChange={(e) => onUrlChange?.(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleRefresh();
            }
          }}
          style={{
            flex: 1,
            fontSize: '12px',
            color: '#333',
            backgroundColor: '#fff',
            padding: '4px 8px',
            border: '1px solid #ddd',
            borderRadius: '4px',
            outline: 'none',
          }}
          placeholder="Enter preview URL..."
        />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: '#666',
            display: 'flex',
            alignItems: 'center',
          }}
          title="Open in New Tab"
        >
          <ExternalLink size={16} />
        </a>
      </div>

      <div style={{ flex: 1, overflow: 'auto', width: '100%', height: '100%' }}>
        {isMarkdown ? (
          <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
            {isLoading ? (
              <div style={{ color: '#888' }}>Loading markdown...</div>
            ) : (
              <ReactMarkdown>{mdContent}</ReactMarkdown>
            )}
          </div>
        ) : (
          <iframe
            key={key}
            src={url}
            style={{
              border: 'none',
              width: '100%',
              height: '100%',
            }}
            title="App Preview"
          />
        )}
      </div>
    </div>
  );
};

export default Preview;
