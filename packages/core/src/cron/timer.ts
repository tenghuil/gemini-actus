import { CronStore } from './store.js';
import { CronOps } from './ops.js';

export class CronTimer {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private stopped = false;

  constructor(
    private readonly store: CronStore,
    private readonly ops: CronOps
  ) {}

  start() {
    this.stopped = false;
    this.armTimer();
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private armTimer() {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    
    this.store.load().then(jobs => {
      let nextRunAtMs: number | undefined;
      for (const job of jobs) {
        if (!job.enabled) continue;
        if (job.state.nextRunAtMs !== undefined) {
          if (nextRunAtMs === undefined || job.state.nextRunAtMs < nextRunAtMs) {
            nextRunAtMs = job.state.nextRunAtMs;
          }
        }
      }
      
      const now = Date.now();
      const delay = nextRunAtMs !== undefined ? Math.max(0, nextRunAtMs - now) : 60000;
      const clampedDelay = Math.min(delay, 60000);
      
      this.timer = setTimeout(() => this.onTimer(), clampedDelay);
    }).catch(err => {
      console.error("CronTimer armTimer failed to load jobs:", err);
      this.timer = setTimeout(() => this.onTimer(), 60000);
    });
  }

  private async onTimer() {
    if (this.stopped) return;
    if (this.isRunning) {
      this.armTimer(); // re-arm watchdog
      return;
    }

    this.isRunning = true;
    try {
      await this.processJobs();
    } catch (e) {
      console.error("CronTimer processJobs error:", e);
    } finally {
      this.isRunning = false;
      this.armTimer();
    }
  }

  private async processJobs() {
    // Keep picking the next due job and running it sequentially
    while (!this.stopped) {
      const jobId = await this.ops.getNextDueJobId();
      if (!jobId) break;
      await this.ops.run(jobId, 'due');
    }
  }
}
