import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';
import { AccountCleanupProducer } from '../../infrastructure/account-cleanup/account-cleanup.producer';
import { AccountCleanupRepository } from './infrastructure/persistence/account-cleanup.repository';

const TASK_NAME = 'account-cleanup-compensation';
const LOCK_TTL_MS = 10 * 60 * 1000;
const GRACE_MS = 30 * 60 * 1000;
const BATCH_SIZE = 200;

/** 已注销超过 30 分钟仍未完成清理的用户重新入队 */
@Injectable()
export class AccountCleanupCompensationTask {
  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly repository: AccountCleanupRepository,
    private readonly producer: AccountCleanupProducer,
  ) {}

  @Cron('25 * * * *', { name: TASK_NAME, timeZone: 'Asia/Shanghai' })
  async handle(): Promise<void> {
    try {
      const run = await this.schedulerService.runExclusive(TASK_NAME, LOCK_TTL_MS, async () => {
        const userIds = await this.repository.findPendingUserIds(new Date(Date.now() - GRACE_MS), BATCH_SIZE);
        for (const userId of userIds) {
          await this.producer.enqueueCleanup(userId);
        }
        return userIds.length;
      });
      if (run.executed) {
        this.schedulerService.logTaskExecution(TASK_NAME, `${run.result} account cleanups enqueued`);
      }
    } catch (error) {
      this.schedulerService.logTaskError(TASK_NAME, error instanceof Error ? error : new Error(String(error)));
    }
  }
}
