import type { CronJob, CronJobCreate } from './types.js';
import { CronStore } from './store.js';
import { computeNextRunAtMs } from './jobs.js';
import { locked } from './locked.js';
import { randomUUID } from 'crypto';

export interface CronExecutionHandlers {
  onSystemEvent?: (text: string) => Promise<void>;
  onAgentTurn?: (message: string, timeoutSeconds?: number, contextId?: string) => Promise<void>;
}

export class CronOps {
  constructor(private store: CronStore, private handlers: CronExecutionHandlers) {}

  async list(includeDisabled = false): Promise<CronJob[]> {
    const jobs = await this.store.load();
    return includeDisabled ? jobs : jobs.filter((j) => j.enabled);
  }

  async add(jobCreate: CronJobCreate): Promise<CronJob> {
    return locked(async () => {
      const jobs = await this.store.load();
      const now = Date.now();
      
      const newJob: CronJob = {
        ...jobCreate,
        id: jobCreate.id || randomUUID(),
        enabled: jobCreate.enabled ?? true,
        state: {},
        createdAtMs: now,
        updatedAtMs: now,
      };

      if (newJob.enabled) {
        newJob.state.nextRunAtMs = computeNextRunAtMs(newJob.schedule, now, 0);
      }

      jobs.push(newJob);
      await this.store.persist(jobs);
      return newJob;
    });
  }

  async update(id: string, patch: Partial<CronJob>): Promise<CronJob> {
    return locked(async () => {
      const jobs = await this.store.load();
      const idx = jobs.findIndex(j => j.id === id);
      if (idx === -1) throw new Error(`Cron job not found: ${id}`);
      
      const job = jobs[idx];
      const updatedJob = { ...job, ...patch, updatedAtMs: Date.now() };

      if (patch.schedule || patch.enabled !== undefined) {
        // Recompute next run immediately if schedule or enabled changed
        if (updatedJob.enabled) {
          updatedJob.state.nextRunAtMs = computeNextRunAtMs(updatedJob.schedule, Date.now(), updatedJob.state.consecutiveErrors || 0);
        } else {
          updatedJob.state.nextRunAtMs = undefined;
        }
      }

      jobs[idx] = updatedJob;
      await this.store.persist(jobs);
      return updatedJob;
    });
  }

  async remove(id: string): Promise<{ removed: boolean }> {
    return locked(async () => {
      const jobs = await this.store.load();
      const filtered = jobs.filter(j => j.id !== id);
      if (filtered.length === jobs.length) return { removed: false };
      await this.store.persist(filtered);
      return { removed: true };
    });
  }

  async getNextDueJobId(): Promise<string | null> {
    const jobs = await this.store.load();
    const now = Date.now();
    for (const job of jobs) {
      if (job.enabled && job.state.nextRunAtMs !== undefined && now >= job.state.nextRunAtMs) {
        if (!job.state.runningAtMs) {
          return job.id;
        }
      }
    }
    return null;
  }

  async run(id: string, mode: 'due' | 'force' = 'force'): Promise<{ ran: boolean }> {
    let jobToRun: CronJob | undefined;
    let now = Date.now();

    // 1. Mark as running
    await locked(async () => {
      const jobs = await this.store.load();
      const idx = jobs.findIndex(j => j.id === id);
      if (idx === -1) return; // not found
      
      const job = jobs[idx];
      if (!job.enabled && mode === 'due') return; // Cannot run due disabled
      if (job.state.runningAtMs) return; // Already running

      if (mode === 'due') {
        if (job.state.nextRunAtMs === undefined || now < job.state.nextRunAtMs) {
          return; // Not due yet
        }
      }

      job.state.runningAtMs = now;
      jobs[idx] = job;
      await this.store.persist(jobs);
      jobToRun = JSON.parse(JSON.stringify(job)); // clone for execution
    });

    if (!jobToRun) return { ran: false };

    // 2. Execute
    const startTime = Date.now();
    let error: string | null = null;
    let runStatus: 'ok' | 'error' = 'ok';

    try {
      if (jobToRun.payload.kind === 'systemEvent') {
        if (this.handlers.onSystemEvent) {
          await this.handlers.onSystemEvent(jobToRun.payload.text);
        } else {
          console.warn('Cron: missing onSystemEvent handler');
        }
      } else if (jobToRun.payload.kind === 'agentTurn') {
        if (this.handlers.onAgentTurn) {
          await this.handlers.onAgentTurn(jobToRun.payload.message, jobToRun.payload.timeoutSeconds, jobToRun.contextId);
        } else {
          console.warn('Cron: missing onAgentTurn handler');
        }
      }
    } catch (e: any) {
      error = e.message || String(e);
      runStatus = 'error';
    }

    const duration = Date.now() - startTime;

    // 3. Write results back
    await locked(async () => {
      const jobs = await this.store.load();
      const idx = jobs.findIndex(j => j.id === id);
      if (idx === -1) return; // Job was deleted while running

      const job = jobs[idx];
      job.state.runningAtMs = undefined;
      job.state.lastRunAtMs = startTime;
      job.state.lastDurationMs = duration;
      job.state.lastRunStatus = runStatus;
      
      if (runStatus === 'error') {
        job.state.lastError = error || undefined;
        job.state.consecutiveErrors = (job.state.consecutiveErrors || 0) + 1;
      } else {
        job.state.lastError = undefined;
        job.state.consecutiveErrors = 0;
      }

      if (runStatus === 'ok' && jobToRun?.schedule.kind === 'at' && jobToRun.deleteAfterRun) {
        // One shot with deleteAfterRun
        jobs.splice(idx, 1);
      } else if (runStatus === 'ok' && jobToRun?.schedule.kind === 'at' && !jobToRun.deleteAfterRun) {
        job.enabled = false;
        job.state.nextRunAtMs = undefined;
      } else if (job.enabled) {
        job.state.nextRunAtMs = computeNextRunAtMs(job.schedule, Date.now(), job.state.consecutiveErrors);
      }

      await this.store.persist(jobs);
    });

    return { ran: true };
  }
}
