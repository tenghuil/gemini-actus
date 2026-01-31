/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import type React from 'react';
import { ChevronRight, ChevronDown, File, Folder } from 'lucide-react';

export interface FileNode {
  name: string;
  path: string;
  type: 'directory' | 'file';
  children?: FileNode[];
}

interface FileTreeProps {
  files: FileNode[];
  onSelectFile: (path: string) => void;
  selectedFile?: string;
  onPreviewFile?: (path: string) => void;
}

const FileTreeNode: React.FC<{
  node: FileNode;
  onSelectFile: (path: string) => void;
  selectedFile?: string;
  depth?: number;
  onPreviewFile?: (path: string) => void;
}> = ({ node, onSelectFile, selectedFile, depth = 0, onPreviewFile }) => {
  const [isOpen, setIsOpen] = useState(false);
  const isSelected = node.path === selectedFile;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.type === 'directory') {
      setIsOpen(!isOpen);
    } else {
      onSelectFile(node.path);
    }
  };

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onPreviewFile) {
      onPreviewFile(node.path);
    }
  };

  return (
    <div>
      <div
        onClick={handleClick}
        style={{
          paddingLeft: `${depth * 12 + 8}px`,
          paddingRight: '8px',
          paddingTop: '4px',
          paddingBottom: '4px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          backgroundColor: isSelected
            ? 'rgba(255, 255, 255, 0.1)'
            : 'transparent',
          color: isSelected ? '#fff' : '#aaa',
          fontSize: '13px',
          userSelect: 'none',
          position: 'relative',
        }}
        className="file-tree-node"
      >
        {node.type === 'directory' &&
          (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />)}
        {node.type === 'file' && <File size={14} />}
        {node.type === 'directory' && <Folder size={14} />}
        <span
          style={{
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: 1,
          }}
        >
          {node.name}
        </span>
        {node.type === 'file' && onPreviewFile && (
          <button
            onClick={handlePreview}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px',
              color: '#888',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: 0.6,
            }}
            title="Preview"
          >
            <>
              {/* Use a simple eye icon SVG if not importing Eye from lucide-react in this file, or import it */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </>
          </button>
        )}
      </div>
      {isOpen && node.children && (
        <div>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              onSelectFile={onSelectFile}
              selectedFile={selectedFile}
              depth={depth + 1}
              onPreviewFile={onPreviewFile}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FileTree: React.FC<FileTreeProps & { cwd?: string }> = ({
  files,
  onSelectFile,
  selectedFile,
  cwd,
  onPreviewFile,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
    {cwd && (
      <div
        style={{
          padding: '8px',
          fontSize: '11px',
          color: '#888',
          borderBottom: '1px solid #333',
          wordBreak: 'break-all',
          backgroundColor: '#252526',
        }}
      >
        📂 {cwd}
      </div>
    )}
    <div style={{ overflowY: 'auto', flex: 1, paddingBottom: '20px' }}>
      {files.map((file) => (
        <FileTreeNode
          key={file.path}
          node={file}
          onSelectFile={onSelectFile}
          selectedFile={selectedFile}
          onPreviewFile={onPreviewFile}
        />
      ))}
    </div>
  </div>
);

export default FileTree;
