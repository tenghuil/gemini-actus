import fs from 'fs/promises';
import type { CronJob } from './types.js';

type StoreData = {
  version: number;
  jobs: CronJob[];
};

export class CronStore {
  constructor(private readonly filePath: string) {}

  async load(): Promise<CronJob[]> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(data) as StoreData;
      return parsed.jobs || [];
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }
  }

  async persist(jobs: CronJob[]): Promise<void> {
    const data: StoreData = {
      version: 1,
      jobs,
    };
    await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }
}
