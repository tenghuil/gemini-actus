/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { debugLogger } from '../utils/debugLogger.js';
import {
  type DeliveryContext,
  deliveryContextKey,
  normalizeDeliveryContext,
} from '../utils/delivery-context.js';

export type QueueMode =
  | 'auto'
  | 'collect'
  | 'interrupt'
  | 'followup'
  | 'steer'
  | 'steer-backlog';
export type QueueDropPolicy = 'keep' | 'new' | 'summarize' | 'drop';

export type AnnounceQueueItem = {
  prompt: string;
  summaryLine?: string;
  enqueuedAt: number;
  sessionKey: string;
  origin?: DeliveryContext;
  originKey?: string;
};

export type AnnounceQueueSettings = {
  mode: QueueMode;
  debounceMs?: number;
  cap?: number;
  dropPolicy?: QueueDropPolicy;
};

type AnnounceQueueState = {
  items: AnnounceQueueItem[];
  draining: boolean;
  lastEnqueuedAt: number;
  mode: QueueMode;
  debounceMs: number;
  cap: number;
  dropPolicy: QueueDropPolicy;
  droppedCount: number;
  send: (item: AnnounceQueueItem) => Promise<void>;
};

const ANNOUNCE_QUEUES = new Map<string, AnnounceQueueState>();

function getAnnounceQueue(
  key: string,
  settings: AnnounceQueueSettings,
  send: (item: AnnounceQueueItem) => Promise<void>,
) {
  const existing = ANNOUNCE_QUEUES.get(key);
  if (existing) {
    existing.mode = settings.mode;
    existing.debounceMs =
      typeof settings.debounceMs === 'number'
        ? Math.max(0, settings.debounceMs)
        : existing.debounceMs;
    existing.cap =
      typeof settings.cap === 'number' && settings.cap > 0
        ? Math.floor(settings.cap)
        : existing.cap;
    existing.dropPolicy = settings.dropPolicy ?? existing.dropPolicy;
    existing.send = send;
    return existing;
  }
  const created: AnnounceQueueState = {
    items: [],
    draining: false,
    lastEnqueuedAt: 0,
    mode: settings.mode,
    debounceMs:
      typeof settings.debounceMs === 'number'
        ? Math.max(0, settings.debounceMs)
        : 1000,
    cap:
      typeof settings.cap === 'number' && settings.cap > 0
        ? Math.floor(settings.cap)
        : 20,
    dropPolicy: settings.dropPolicy ?? 'summarize',
    droppedCount: 0,
    send,
  };
  ANNOUNCE_QUEUES.set(key, created);
  return created;
}

function scheduleAnnounceDrain(key: string) {
  const queue = ANNOUNCE_QUEUES.get(key);
  if (!queue || queue.draining) return;
  queue.draining = true;
  void (async () => {
    try {
      while (queue.items.length > 0 || queue.droppedCount > 0) {
        // Simple debounce
        if (Date.now() - queue.lastEnqueuedAt < queue.debounceMs) {
          await new Promise((resolve) =>
            setTimeout(resolve, queue.debounceMs / 2),
          );
          continue;
        }

        const next = queue.items.shift();
        if (!next) break;
        await queue.send(next);
      }
    } catch (err: unknown) {
      debugLogger.error(
        `announce queue drain failed for ${key}: ${String(err)}`,
      );
    } finally {
      queue.draining = false;
      if (queue.items.length === 0 && queue.droppedCount === 0) {
        ANNOUNCE_QUEUES.delete(key);
      } else {
        // Re-schedule if new items arrived
        setTimeout(() => scheduleAnnounceDrain(key), 100);
      }
    }
  })();
}

export function enqueueAnnounce(params: {
  key: string;
  item: AnnounceQueueItem;
  settings: AnnounceQueueSettings;
  send: (item: AnnounceQueueItem) => Promise<void>;
}): boolean {
  const queue = getAnnounceQueue(params.key, params.settings, params.send);
  queue.lastEnqueuedAt = Date.now();

  const origin = normalizeDeliveryContext(params.item.origin);
  const originKey = deliveryContextKey(origin);
  queue.items.push({ ...params.item, origin, originKey });
  scheduleAnnounceDrain(params.key);
  return true;
}
