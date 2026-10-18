import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ACCOUNT_CLEANUP_QUEUE, AccountCleanupJobData } from './account-cleanup-queue.constants';
import { AccountCleanupRunner } from '../../../modules/account-cleanup/account-cleanup.runner';

@Processor(ACCOUNT_CLEANUP_QUEUE, { concurrency: 1 })
export class AccountCleanupQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(AccountCleanupQueueProcessor.name);

  constructor(private readonly runner: AccountCleanupRunner) {
    super();
  }

  /** 出错时由队列重试并重新执行全部清理器，最后一次仍失败时告警 */
  async process(job: Job<AccountCleanupJobData>): Promise<void> {
    try {
      await this.runner.run(job.data.userId);
    } catch (error) {
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await this.runner.reportFailure(job.data.userId, error);
      }
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(`Account cleanup job ${job?.id} failed: ${error.message}`);
  }
}
