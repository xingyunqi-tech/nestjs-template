import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, Job } from 'bullmq';
import { STUDY_STATS_QUEUE, StudyStatsJobData } from './study-stats-queue.constants';
import { StatsEventService } from '../../../modules/study-stats/stats-event.service';

export const LOCK_RETRY_DELAY_MS = 1000;

@Processor(STUDY_STATS_QUEUE)
export class StudyStatsQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(StudyStatsQueueProcessor.name);

  constructor(private readonly statsEventService: StatsEventService) {
    super();
  }

  /** 用户锁被占用时保留同一 jobId 延迟重试 */
  async process(job: Job<StudyStatsJobData>, token?: string): Promise<void> {
    const { data } = job;
    const result =
      'recordId' in data
        ? await this.statsEventService.processRecord(data.recordId)
        : 'sessionId' in data
          ? await this.statsEventService.processSession(data.sessionId)
          : await this.statsEventService.processCheckIn(data.userId, data.date);
    if (result === 'locked') {
      await job.moveToDelayed(
        Date.now() + LOCK_RETRY_DELAY_MS + Math.floor(Math.random() * LOCK_RETRY_DELAY_MS),
        token,
      );
      throw new DelayedError();
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Study stats job ${job?.id} failed: ${error.message}`);
  }
}
