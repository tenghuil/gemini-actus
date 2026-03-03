/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { execSync } from 'node:child_process';
import {
  writeFileSync,
  copyFileSync,
  unlinkSync,
  existsSync,
  chmodSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const bundlePath = join(root, 'bundle', 'gemini.cjs');
if (!existsSync(bundlePath)) {
  console.error(
    `Error: Could not find CJS bundle at ${bundlePath}. Did you run 'npm run bundle' first?`,
  );
  process.exit(1);
}

const isWindows = os.platform() === 'win32';
const executableName = isWindows ? 'gemini-agent.exe' : 'gemini-agent';
const executablePath = join(root, executableName);

// 1. Create sea-config.json
const seaConfigPath = join(root, 'sea-config.json');
const seaPrepBlobPath = join(root, 'sea-prep.blob');

const seaConfig = {
  main: 'bundle/gemini.cjs',
  output: 'sea-prep.blob',
  disableExperimentalSEAWarning: true,
};
writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));

console.log('Generating SEA blob...');
try {
  // 2. Generate blob
  execSync(`node --experimental-sea-config sea-config.json`, {
    stdio: 'inherit',
    cwd: root,
  });

  // 3. Copy node executable
  console.log(`Copying node executable to ${executableName}...`);
  copyFileSync(process.execPath, executablePath);

  // 4. Inject blob
  console.log('Injecting blob...');
  const postjectCmd = `npx --yes postject ${executableName} NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2${os.platform() === 'darwin' ? ' --macho-segment-name NODE_SEA' : ''}`;
  execSync(postjectCmd, { stdio: 'inherit', cwd: root });

  // 5. Set permissions and sign
  if (!isWindows) {
    chmodSync(executablePath, '755');
  }

  if (os.platform() === 'darwin') {
    console.log('Codesigning executable for macOS...');
    execSync(`codesign --sign - ${executableName}`, {
      stdio: 'inherit',
      cwd: root,
    });
  }

  console.log(`Successfully created executable at: ${executablePath}`);
} catch (error) {
  console.error('Failed to build executable:', error.message);
  process.exit(1);
} finally {
  // Cleanup
  if (existsSync(seaConfigPath)) unlinkSync(seaConfigPath);
  if (existsSync(seaPrepBlobPath)) unlinkSync(seaPrepBlobPath);
}
