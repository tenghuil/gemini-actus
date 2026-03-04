import { CronStore } from './store.js';
import { CronOps } from './ops.js';
import type { CronExecutionHandlers } from './ops.js';
import { CronTimer } from './timer.js';
import type { CronJobCreate, CronJob } from './types.js';
import { computeNextRunAtMs } from './jobs.js';
import { locked } from './locked.js';

export class CronService {
  private store: CronStore;
  private ops: CronOps;
  private timer: CronTimer;

  constructor(filePath: string, handlers: CronExecutionHandlers) {
    this.store = new CronStore(filePath);
    this.ops = new CronOps(this.store, handlers);
    this.timer = new CronTimer(this.store, this.ops);
  }

  async start(): Promise<void> {
    await this.startupHandling();
    this.timer.start();
  }

  stop(): void {
    this.timer.stop();
  }

  add(job: CronJobCreate): Promise<CronJob> {
    return this.ops.add(job);
  }

  update(id: string, patch: Partial<CronJob>): Promise<CronJob> {
    return this.ops.update(id, patch);
  }

  remove(id: string): Promise<{ removed: boolean }> {
    return this.ops.remove(id);
  }

  list(opts?: { includeDisabled?: boolean }): Promise<CronJob[]> {
    return this.ops.list(opts?.includeDisabled);
  }

  run(id: string, mode?: "due" | "force"): Promise<{ ran: boolean }> {
    return this.ops.run(id, mode);
  }

  private async startupHandling() {
    await locked(async () => {
      const jobs = await this.store.load();
      let changed = false;
      const now = Date.now();

      for (const job of jobs) {
        let modifiedJob = false;

        if (job.state.runningAtMs) {
          job.state.runningAtMs = undefined;
          modifiedJob = true;
        }

        if (job.enabled) {
          if (job.state.nextRunAtMs !== undefined && job.state.nextRunAtMs <= now) {
             // Missed job: leave nextRunAtMs in the past, timer will run it immediately
          } else {
             const recomputed = computeNextRunAtMs(job.schedule, now, job.state.consecutiveErrors);
             if (job.state.nextRunAtMs !== recomputed) {
               job.state.nextRunAtMs = recomputed;
               modifiedJob = true;
             }
          }
        } else {
          if (job.state.nextRunAtMs !== undefined) {
             job.state.nextRunAtMs = undefined;
             modifiedJob = true;
          }
        }

        if (modifiedJob) {
          changed = true;
        }
      }

      if (changed) {
        await this.store.persist(jobs);
      }
    });
  }
}
