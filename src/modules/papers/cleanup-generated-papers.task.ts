import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';
import { PaperRepository } from './infrastructure/persistence/paper.repository';

const TASK_NAME = 'cleanup-generated-papers';
const LOCK_TTL_MS = 10 * 60 * 1000;
const RETENTION_DAYS = 7;
const BATCH_SIZE = 500;
const DAY_MS = 86_400_000;

/** 删除创建超过 7 天且从未开考的个人试卷 */
@Injectable()
export class CleanupGeneratedPapersTask {
  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly paperRepository: PaperRepository,
  ) {}

  @Cron('40 3 * * *', { name: TASK_NAME, timeZone: 'Asia/Shanghai' })
  async handle(): Promise<void> {
    try {
      const run = await this.schedulerService.runExclusive(TASK_NAME, LOCK_TTL_MS, () =>
        this.paperRepository.removeStaleGenerated(new Date(Date.now() - RETENTION_DAYS * DAY_MS), BATCH_SIZE),
      );
      if (run.executed) {
        this.schedulerService.logTaskExecution(TASK_NAME, `${run.result} generated papers removed`);
      }
    } catch (error) {
      this.schedulerService.logTaskError(TASK_NAME, error instanceof Error ? error : new Error(String(error)));
    }
  }
}
