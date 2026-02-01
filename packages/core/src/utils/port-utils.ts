/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import net from 'node:net';

/**
 * Checks if a port is open/listening on a given host.
 * @param port The port number to check.
 * @param host The host to check (defaults to 'localhost').
 * @param timeout The timeout for the connection attempt in milliseconds (defaults to 1000).
 * @returns A promise that resolves to true if the port is open, false otherwise.
 */
export async function isPortOpen(
  port: number,
  host: string = 'localhost',
  timeout: number = 1000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();

    const onFinish = (status: boolean) => {
      socket.destroy();
      resolve(status);
    };

    socket.setTimeout(timeout);
    socket.once('connect', () => onFinish(true));
    socket.once('timeout', () => onFinish(false));
    socket.once('error', () => onFinish(false));

    socket.connect(port, host);
  });
}
