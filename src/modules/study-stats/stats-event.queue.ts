import { Injectable, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { JobsOptions, Queue } from 'bullmq';
import {
  STUDY_STATS_QUEUE,
  StudyStatsJobData,
  StudyStatsJobName,
  sessionJobId,
} from '../../infrastructure/queue/study-stats-queue/study-stats-queue.constants';

const JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: true,
  removeOnFail: 1000,
};

const FINISHED_STATES = new Set(['completed', 'failed']);

/** 统计事件入队，未启用队列时为空操作 */
@Injectable()
export class StatsEventQueue {
  constructor(@Optional() @InjectQueue(STUDY_STATS_QUEUE) private readonly queue?: Queue<StudyStatsJobData>) {}

  async publishRecord(recordId: string): Promise<void> {
    await this.queue?.add(StudyStatsJobName.RECORD, { recordId }, { ...JOB_OPTIONS, jobId: recordId });
  }

  async publishSession(sessionId: string): Promise<void> {
    await this.queue?.add(StudyStatsJobName.SESSION, { sessionId }, { ...JOB_OPTIONS, jobId: sessionJobId(sessionId) });
  }

  get enabled(): boolean {
    return Boolean(this.queue);
  }

  /** 返回是否入队；同一 jobId 的任务仍在排队或执行时不入队 */
  async requeueRecord(recordId: string): Promise<boolean> {
    if (!this.queue) {
      return false;
    }
    const existing = await this.queue.getJob(recordId);
    if (existing) {
      const state = await existing.getState();
      if (FINISHED_STATES.has(state)) {
        await existing.remove();
      } else if (state !== 'unknown') {
        return false;
      }
    }
    await this.publishRecord(recordId);
    return true;
  }
}
