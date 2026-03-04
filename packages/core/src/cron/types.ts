export type CronJobState = {
  nextRunAtMs?: number;
  runningAtMs?: number;
  lastRunAtMs?: number;
  lastRunStatus?: "ok" | "error" | "skipped";
  lastError?: string;
  lastDurationMs?: number;
  consecutiveErrors?: number;
};

export type ScheduleAt = { kind: "at"; at: string };
export type ScheduleEvery = { kind: "every"; everyMs: number; anchorMs?: number };
export type ScheduleCron = { kind: "cron"; expr: string; tz?: string };

export type CronSchedule = ScheduleAt | ScheduleEvery | ScheduleCron;

export type PayloadSystemEvent = { kind: "systemEvent"; text: string };
export type PayloadAgentTurn = { kind: "agentTurn"; message: string; timeoutSeconds?: number };

export type CronPayload = PayloadSystemEvent | PayloadAgentTurn;

export type CronJob = {
  id: string;
  name: string;
  enabled: boolean;
  deleteAfterRun?: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  contextId?: string;
  state: CronJobState;
  createdAtMs: number;
  updatedAtMs: number;
};

export type CronJobCreate = Omit<CronJob, "id" | "state" | "createdAtMs" | "updatedAtMs"> & { id?: string };
