/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export type DeliveryContext = {
  channel?: string;
  to?: string;
  accountId?: string;
  threadId?: string | number;
};

export type DeliveryContextSessionSource = {
  channel?: string;
  lastChannel?: string;
  lastTo?: string;
  lastAccountId?: string;
  lastThreadId?: string | number;
  deliveryContext?: DeliveryContext;
};

function normalizeMessageChannel(channel?: string): string | undefined {
  return channel?.trim().toLowerCase() || undefined;
}

function normalizeAccountId(accountId?: string): string | undefined {
  return accountId?.trim() || undefined;
}

export function normalizeDeliveryContext(
  context?: DeliveryContext,
): DeliveryContext | undefined {
  if (!context) return undefined;
  const channel =
    typeof context.channel === 'string'
      ? normalizeMessageChannel(context.channel)
      : undefined;
  const to = typeof context.to === 'string' ? context.to.trim() : undefined;
  const accountId = normalizeAccountId(context.accountId);
  const threadId =
    typeof context.threadId === 'number' && Number.isFinite(context.threadId)
      ? Math.trunc(context.threadId)
      : typeof context.threadId === 'string'
        ? context.threadId.trim()
        : undefined;
  const normalizedThreadId =
    typeof threadId === 'string' ? (threadId ? threadId : undefined) : threadId;
  if (!channel && !to && !accountId && normalizedThreadId == null)
    return undefined;
  const normalized: DeliveryContext = {
    channel: channel || undefined,
    to: to || undefined,
    accountId,
  };
  if (normalizedThreadId != null) normalized.threadId = normalizedThreadId;
  return normalized;
}

export function mergeDeliveryContext(
  primary?: DeliveryContext,
  fallback?: DeliveryContext,
): DeliveryContext | undefined {
  const normalizedPrimary = normalizeDeliveryContext(primary);
  const normalizedFallback = normalizeDeliveryContext(fallback);
  if (!normalizedPrimary && !normalizedFallback) return undefined;
  return normalizeDeliveryContext({
    channel: normalizedPrimary?.channel ?? normalizedFallback?.channel,
    to: normalizedPrimary?.to ?? normalizedFallback?.to,
    accountId: normalizedPrimary?.accountId ?? normalizedFallback?.accountId,
    threadId: normalizedPrimary?.threadId ?? normalizedFallback?.threadId,
  });
}

export function deliveryContextKey(
  context?: DeliveryContext,
): string | undefined {
  const normalized = normalizeDeliveryContext(context);
  if (!normalized?.channel || !normalized?.to) return undefined;
  const threadId =
    normalized.threadId != null && normalized.threadId !== ''
      ? String(normalized.threadId)
      : '';
  return `${normalized.channel}|${normalized.to}|${normalized.accountId ?? ''}|${threadId}`;
}

export function deliveryContextFromSession(
  entry?: DeliveryContextSessionSource,
): DeliveryContext | undefined {
  if (!entry) return undefined;
  return mergeDeliveryContext(
    normalizeDeliveryContext({
      channel: entry.lastChannel ?? entry.channel,
      to: entry.lastTo,
      accountId: entry.lastAccountId,
      threadId: entry.lastThreadId,
    }),
    normalizeDeliveryContext(entry.deliveryContext),
  );
}
