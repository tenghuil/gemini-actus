/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import type React from 'react';
import { Eye, Code, RefreshCw } from 'lucide-react';
import Preview from './Preview';
import CodeViewer from './CodeViewer';
import FileTree from './FileTree';
import type { FileNode } from './FileTree';

interface CanvasProps {
  previewUrl?: string | null;
  chatId?: string;
  onPreviewUrlChange?: (url: string) => void;
  lastTouchedFile?: string | null;
}

const Canvas: React.FC<CanvasProps> = ({
  previewUrl,
  chatId,
  onPreviewUrlChange,
  lastTouchedFile,
}) => {
  const [activeTab, setActiveTab] = useState<'ui' | 'code'>('ui');
  const [files, setFiles] = useState<FileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | undefined>(
    undefined,
  );
  const [fileContent, setFileContent] = useState<string>('');
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [cwd, setCwd] = useState<string>('');

  // Fetch files only when switching to code view for the first time or explicitly refreshing
  const fetchFiles = useCallback(async () => {
    try {
      const query = chatId ? `?chatId=${chatId}` : '';
      const res = await fetch(`/api/files/list${query}`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data);
      }

      const cwdRes = await fetch('/api/cwd');
      if (cwdRes.ok) {
        const cwdData = await cwdRes.json();
        setCwd(cwdData.cwd);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to fetch files:', error);
    }
  }, [chatId]);

  useEffect(() => {
    if (activeTab === 'code') {
      void fetchFiles();
    }
  }, [activeTab, fetchFiles]); // Removed files.length check to allow refresh on chat switch

  useEffect(() => {
    if (previewUrl) {
      setActiveTab('ui');
    }
  }, [previewUrl]);

  const handleFileSelect = useCallback(
    async (path: string) => {
      setSelectedFile(path);
      setIsLoadingFile(true);
      try {
        const res = await fetch('/api/files/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, chatId }),
        });
        if (res.ok) {
          const data = await res.json();
          setFileContent(data.content);
        } else {
          setFileContent('Failed to load file content.');
        }
      } catch (error) {
        setFileContent('Error loading file content: ' + String(error));
      } finally {
        setIsLoadingFile(false);
      }
    },
    [chatId],
  );

  useEffect(() => {
    if (lastTouchedFile) {
      // Determine tab based on extension
      const ext = lastTouchedFile.split('.').pop()?.toLowerCase();
      if (ext === 'html' || ext === 'md') {
        setActiveTab('ui');
      } else {
        setActiveTab('code');
        // If we are in code tab, we should also select the file
        // But we need the relative path from workspace root
        const workspacePart = '/.workspace/';
        const idx = lastTouchedFile.indexOf(workspacePart);
        if (idx !== -1) {
          const relativePath = lastTouchedFile
            .substring(idx + workspacePart.length)
            .split('/')
            .slice(1)
            .join('/');
          void handleFileSelect(relativePath);
        }
      }
    }
  }, [lastTouchedFile, handleFileSelect]);

  const currentLanguage = selectedFile
    ? selectedFile.split('.').pop() || 'text'
    : 'text';

  // Map extension to language for syntax highlighter if needed,
  // but react-syntax-highlighter handles common extensions well mostly.
  // We can refine if needed.

  const handlePreviewFile = (path: string) => {
    if (onPreviewUrlChange && chatId) {
      // Ensure path starts with /
      const cleanPath = path.startsWith('/') ? path : `/${path}`;
      const url = `/preview/${chatId}${cleanPath}`;
      onPreviewUrlChange(url);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#1e1e1e',
        color: '#fff',
      }}
    >
      {/* Header / Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid #333',
          backgroundColor: '#252526',
        }}
      >
        <button
          onClick={() => setActiveTab('ui')}
          style={{
            flex: 1,
            padding: '10px',
            background: activeTab === 'ui' ? '#1e1e1e' : 'transparent',
            border: 'none',
            color: activeTab === 'ui' ? '#fff' : '#888',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            borderTop:
              activeTab === 'ui'
                ? '2px solid #007fd4'
                : '2px solid transparent',
          }}
        >
          <Eye size={16} /> UI
        </button>
        <button
          onClick={() => setActiveTab('code')}
          style={{
            flex: 1,
            padding: '10px',
            background: activeTab === 'code' ? '#1e1e1e' : 'transparent',
            border: 'none',
            color: activeTab === 'code' ? '#fff' : '#888',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            borderTop:
              activeTab === 'code'
                ? '2px solid #007fd4'
                : '2px solid transparent',
          }}
        >
          <Code size={16} /> Code
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {activeTab === 'ui' ? (
          <div style={{ flex: 1 }}>
            <Preview
              url={previewUrl || 'http://localhost:3000'}
              onUrlChange={onPreviewUrlChange}
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* File Sidebar */}
            <div
              style={{
                width: '250px',
                borderRight: '1px solid #333',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div
                style={{
                  padding: '8px',
                  borderBottom: '1px solid #333',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 'bold',
                    color: '#ccc',
                  }}
                >
                  FILES
                </span>
                <button
                  onClick={fetchFiles}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#ccc',
                    cursor: 'pointer',
                  }}
                >
                  <RefreshCw size={12} />
                </button>
              </div>
              <FileTree
                files={files}
                onSelectFile={handleFileSelect}
                selectedFile={selectedFile}
                cwd={cwd}
                onPreviewFile={handlePreviewFile} // Add this
              />
            </div>

            {/* Editor Area */}
            <div
              style={{
                flex: 1,
                overflow: 'hidden',
                backgroundColor: '#1e1e1e',
              }}
            >
              {selectedFile ? (
                isLoadingFile ? (
                  <div style={{ padding: '20px', color: '#888' }}>
                    Loading...
                  </div>
                ) : (
                  <CodeViewer
                    content={fileContent}
                    language={currentLanguage}
                  />
                )
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    color: '#555',
                  }}
                >
                  Select a file to view source
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Canvas;
