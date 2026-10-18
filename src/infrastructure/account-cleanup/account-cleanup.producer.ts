import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { JobsOptions, Queue } from 'bullmq';
import {
  ACCOUNT_CLEANUP_JOB_NAME,
  ACCOUNT_CLEANUP_QUEUE,
  AccountCleanupJobData,
  accountCleanupJobId,
} from '../queue/account-cleanup-queue/account-cleanup-queue.constants';
import { AlertReporter } from '../alerting/alert-reporter';
import { raiseAccountCleanupFailure } from './account-cleanup-alert';

export const ACCOUNT_CLEANUP_JOB_ATTEMPTS = 5;

const JOB_OPTIONS: JobsOptions = {
  attempts: ACCOUNT_CLEANUP_JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: 100,
  removeOnFail: 1000,
};

const FINISHED_STATES = new Set(['completed', 'failed']);

export type InProcessCleanupRunner = (userId: number) => Promise<void>;

/** 账号清理任务入队；未启用队列时交给进程内执行器 */
@Injectable()
export class AccountCleanupProducer {
  private readonly logger = new Logger(AccountCleanupProducer.name);
  private inProcessRunner?: InProcessCleanupRunner;

  constructor(
    @Optional() @InjectQueue(ACCOUNT_CLEANUP_QUEUE) private readonly queue?: Queue<AccountCleanupJobData>,
    @Optional() private readonly alertReporter?: AlertReporter,
  ) {}

  get queueEnabled(): boolean {
    return Boolean(this.queue);
  }

  setInProcessRunner(runner: InProcessCleanupRunner): void {
    this.inProcessRunner = runner;
  }

  /** 已有任务排队或执行中时不重复入队；入队失败时告警 */
  async enqueueCleanup(userId: number): Promise<void> {
    if (!this.queue) {
      const runner = this.inProcessRunner;
      if (runner) {
        setImmediate(() => void runner(userId));
      } else {
        this.logger.warn(`No account cleanup runner for user ${userId}`);
      }
      return;
    }
    try {
      await this.add(this.queue, userId);
    } catch (error) {
      await raiseAccountCleanupFailure(this.alertReporter, this.logger, userId, error);
    }
  }

  private async add(queue: Queue<AccountCleanupJobData>, userId: number): Promise<void> {
    const jobId = accountCleanupJobId(userId);
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (FINISHED_STATES.has(state)) {
        await existing.remove();
      } else if (state !== 'unknown') {
        return;
      }
    }
    await queue.add(ACCOUNT_CLEANUP_JOB_NAME, { userId }, { ...JOB_OPTIONS, jobId });
  }
}
