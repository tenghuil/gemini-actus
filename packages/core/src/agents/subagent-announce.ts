/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { debugLogger } from '../utils/debugLogger.js';
import {
  type DeliveryContext,
  normalizeDeliveryContext,
} from '../utils/delivery-context.js';
import {
  enqueueAnnounce,
  type AnnounceQueueItem,
} from './subagent-announce-queue.js';
import { A2AClientManager } from './a2a-client-manager.js';
import { coreEvents } from '../utils/events.js';

export type SubagentRunOutcome = {
  status: 'ok' | 'error' | 'timeout' | 'unknown';
  error?: string;
};

function formatDurationShort(valueMs?: number) {
  if (!valueMs || !Number.isFinite(valueMs) || valueMs <= 0) return undefined;
  const totalSeconds = Math.round(valueMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

async function sendAnnounce(item: AnnounceQueueItem) {
  const origin = item.origin;
  // If we have a specific target agent account/channel, use A2A
  if (origin?.to && origin.to !== 'main') {
    try {
      await A2AClientManager.getInstance().sendMessage(origin.to, item.prompt);
    } catch (e) {
      debugLogger.warn(`Failed to send announce to ${origin.to}:`, e);
    }
  } else {
    // Default to main output/feedback for the user
    coreEvents.emitFeedback('info', item.prompt);
  }
}

export async function buildSubagentStatsLine(params: {
  sessionKey: string;
  startedAt?: number;
  endedAt?: number;
}) {
  const runtimeMs =
    typeof params.startedAt === 'number' && typeof params.endedAt === 'number'
      ? Math.max(0, params.endedAt - params.startedAt)
      : undefined;

  const parts: string[] = [];
  const runtime = formatDurationShort(runtimeMs);
  parts.push(`runtime ${runtime ?? 'n/a'}`);
  parts.push(`sessionKey ${params.sessionKey}`);

  // TODO: Add token usage stats if available from session store

  return `Stats: ${parts.join(' \u2022 ')}`;
}

export async function runSubagentAnnounceFlow(params: {
  childSessionKey: string;
  childRunId: string;
  requesterSessionKey: string;
  requesterOrigin?: DeliveryContext;
  requesterDisplayKey: string;
  task: string;
  timeoutMs: number;
  cleanup: 'delete' | 'keep';
  roundOneReply?: string;
  waitForCompletion?: boolean;
  startedAt?: number;
  endedAt?: number;
  label?: string;
  outcome?: SubagentRunOutcome;
}): Promise<boolean> {
  try {
    const requesterOrigin = normalizeDeliveryContext(params.requesterOrigin);
    let outcome: SubagentRunOutcome | undefined = params.outcome;

    if (!outcome) outcome = { status: 'unknown' };

    // Build stats
    const statsLine = await buildSubagentStatsLine({
      sessionKey: params.childSessionKey,
      startedAt: params.startedAt,
      endedAt: params.endedAt,
    });

    // Build status label
    const statusLabel =
      outcome.status === 'ok'
        ? 'completed successfully'
        : outcome.status === 'timeout'
          ? 'timed out'
          : outcome.status === 'error'
            ? `failed: ${outcome.error || 'unknown error'}`
            : 'finished with unknown status';

    // Build instructional message
    const taskLabel = params.label || params.task || 'background task';
    const triggerMessage = [
      `A background task "${taskLabel}" just ${statusLabel}.`,
      '',
      'Findings:',
      params.roundOneReply || '(no output)',
      '',
      statsLine,
    ].join('\n');

    const origin = requesterOrigin ??
      // Fallback: try to deliver to "main" if no specific origin
      // In a real A2A setup, we might look up the requester session in session store if we had access
      { to: 'main' };

    enqueueAnnounce({
      key: params.requesterSessionKey || 'global',
      item: {
        prompt: triggerMessage,
        summaryLine: taskLabel,
        enqueuedAt: Date.now(),
        sessionKey: params.requesterSessionKey,
        origin,
      },
      settings: { mode: 'auto' }, // Simple default
      send: sendAnnounce,
    });

    return true;
  } catch (err) {
    debugLogger.error(`Subagent announce failed: ${String(err)}`);
    return false;
  }
}
