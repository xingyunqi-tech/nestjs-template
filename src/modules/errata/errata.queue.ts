import { Injectable, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { JobsOptions, Queue } from 'bullmq';
import {
  ERRATA_JOB_NAME,
  ERRATA_QUEUE,
  ErrataJobData,
} from '../../infrastructure/queue/errata-queue/errata-queue.constants';

export const ERRATA_JOB_ATTEMPTS = 3;

const JOB_OPTIONS: JobsOptions = {
  attempts: ERRATA_JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: 100,
  removeOnFail: 1000,
};

const FINISHED_STATES = new Set(['completed', 'failed']);

@Injectable()
export class ErrataQueue {
  constructor(@Optional() @InjectQueue(ERRATA_QUEUE) private readonly queue?: Queue<ErrataJobData>) {}

  get enabled(): boolean {
    return Boolean(this.queue);
  }

  /** jobId 为勘误 id；已结束的旧 job 先移除；仍在排队或执行时 replace 为 false 不重复入队，为 true 时移除后入队，无法移除则以新 jobId 入队 */
  async publish(errataId: string, replace = false): Promise<void> {
    if (!this.queue) {
      return;
    }
    let jobId = errataId;
    const existing = await this.queue.getJob(errataId);
    if (existing) {
      const state = await existing.getState();
      const finished = FINISHED_STATES.has(state) || state === 'unknown';
      if (!finished && !replace) {
        return;
      }
      try {
        await existing.remove();
      } catch {
        jobId = `${errataId}-${Date.now()}`;
      }
    }
    await this.queue.add(ERRATA_JOB_NAME, { errataId }, { ...JOB_OPTIONS, jobId });
  }
}
