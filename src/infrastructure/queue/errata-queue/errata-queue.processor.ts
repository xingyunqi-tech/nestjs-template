import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, Job } from 'bullmq';
import { ERRATA_QUEUE, ErrataJobData } from './errata-queue.constants';
import { ERRATA_DEFER_MS, ErrataExecution, ErrataService } from '../../../modules/errata/errata.service';

@Processor(ERRATA_QUEUE, { concurrency: 1 })
export class ErrataQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(ErrataQueueProcessor.name);

  constructor(private readonly errataService: ErrataService) {
    super();
  }

  /** 出错时由队列重试并从已处理用户之后继续，最后一次仍失败时置为 FAILED 并告警；有用户被跳过时延迟同一 job，不计失败次数 */
  async process(job: Job<ErrataJobData>, token?: string): Promise<void> {
    let execution: ErrataExecution;
    try {
      execution = await this.errataService.execute(job.data.errataId);
    } catch (error) {
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await this.errataService.markFailed(job.data.errataId, error);
      }
      throw error;
    }
    if (execution.status === 'deferred') {
      await job.moveToDelayed(Date.now() + ERRATA_DEFER_MS, token);
      throw new DelayedError();
    }
    if (execution.status === 'finished') {
      const { errata } = execution;
      this.logger.log(`Errata ${errata.id} ${errata.status}: ${errata.processedUsers}/${errata.affectedUsers} users`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Errata job ${job?.id} failed: ${error.message}`);
  }
}
