/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/* global chrome, document */
/* eslint-env browser, webextensions */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const statusDiv = document.getElementById('status');
const logDiv = document.getElementById('log');
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const reconnectBtn = document.getElementById('reconnect');

function log(msg) {
  logDiv.textContent += msg + '\n';
  logDiv.scrollTop = logDiv.scrollHeight;
}

// We rely on background script for actual connection,
// but we could also connect here if we want the side panel to be the main controller.
// For now, let's just listen to status updates from background if possible,
// OR just have the background do the work and this be a dummy UI.

// Actually, manifest v3 background service workers go to sleep.
// A side panel kept open might be a better place for the persistent connection
// if the user wants it to stay active.
// However, the prompt asked for "The agent loop runs outside... extension can control...".
// Background script is standard for "headless-ish" control, but service worker lifetime is an issue.
// If the user keeps the side panel open, we can use it to keep the session alive or proxy.

// Let's stick to background script for now, but maybe send keepalives?
// Or, if we want to be robust, we open the side panel programmatically?
// (Chrome doesn't allow opening side panel without user gesture easily).

// For simple debugging, let's just show a message.
log('Side panel loaded.');

// TODO: Communicate with background script to get status.
chrome.runtime.sendMessage({ type: 'getStatus' }, (response) => {
  if (chrome.runtime.lastError) {
    log('Error contacting background: ' + chrome.runtime.lastError.message);
  } else {
    log('Status: ' + JSON.stringify(response));
  }
});
