import { Cron } from 'croner';
import type { CronSchedule } from './types.js';

export function getBackoffMs(consecutiveErrors: number): number {
  if (consecutiveErrors <= 0) return 0;
  if (consecutiveErrors === 1) return 30 * 1000;
  if (consecutiveErrors === 2) return 60 * 1000;
  if (consecutiveErrors === 3) return 5 * 60 * 1000;
  if (consecutiveErrors === 4) return 15 * 60 * 1000;
  return 60 * 60 * 1000;
}

export function computeNextRunAtMs(
  schedule: CronSchedule,
  nowMs: number,
  consecutiveErrors = 0
): number | undefined {
  let naturalNextRunAtMs: number | undefined;

  if (schedule.kind === 'at') {
    naturalNextRunAtMs = new Date(schedule.at).getTime();
    if (isNaN(naturalNextRunAtMs)) {
      return undefined;
    }
  } else if (schedule.kind === 'every') {
    const anchor = schedule.anchorMs ?? 0;
    const interval = schedule.everyMs;
    // Strictly find the next tick after nowMs
    const ticks = Math.floor((nowMs - anchor) / interval) + 1;
    naturalNextRunAtMs = anchor + ticks * interval;
  } else if (schedule.kind === 'cron') {
    try {
      const cron = new Cron(schedule.expr, { timezone: schedule.tz });
      const nextDate = cron.nextRun(new Date(nowMs));
      if (nextDate) {
        naturalNextRunAtMs = nextDate.getTime();
      }
    } catch {
      return undefined;
    }
  }

  if (naturalNextRunAtMs === undefined) return undefined;

  const backoffMs = getBackoffMs(consecutiveErrors);
  return Math.max(naturalNextRunAtMs, nowMs + backoffMs);
}
