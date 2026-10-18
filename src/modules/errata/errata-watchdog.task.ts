import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';
import { ErrataService } from './errata.service';

const TASK_NAME = 'errata-watchdog';
const LOCK_TTL_MS = 4 * 60 * 1000;

@Injectable()
export class ErrataWatchdogTask {
  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly errataService: ErrataService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: TASK_NAME })
  async handle(): Promise<void> {
    try {
      const run = await this.schedulerService.runExclusive(TASK_NAME, LOCK_TTL_MS, () =>
        this.errataService.resumeStale(),
      );
      if (run.executed && run.result > 0) {
        this.schedulerService.logTaskExecution(TASK_NAME, `${run.result} stale errata dispatched`);
      }
    } catch (error) {
      this.schedulerService.logTaskError(TASK_NAME, error instanceof Error ? error : new Error(String(error)));
    }
  }
}
