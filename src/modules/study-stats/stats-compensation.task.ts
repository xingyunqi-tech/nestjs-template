import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';
import { AlertLevel, AlertReporter } from '../../infrastructure/alerting/alert-reporter';
import { AppConfigService } from '../config/config.service';
import { PendingRecordCursor, StatsEventRepository } from './infrastructure/persistence/stats-event.repository';
import { StatsEventQueue } from './stats-event.queue';

const TASK_NAME = 'stats-compensation';
const LOCK_TTL_MS = 9 * 60 * 1000;
const PENDING_GRACE_MS = 10 * 60 * 1000;
const BATCH_SIZE = 200;
const MAX_BATCHES = 50;

export const STATS_COMPENSATION_ALERT_TYPE = 'statsCompensationBacklog';
export const STATS_COMPENSATION_THRESHOLD_KEY = 'statsCompensation';
export const DEFAULT_STATS_COMPENSATION_THRESHOLD = 100;

/** 已判分超过 10 分钟仍未计入统计的记录重新入队 */
@Injectable()
export class StatsCompensationTask {
  private readonly logger = new Logger(StatsCompensationTask.name);

  constructor(
    private readonly schedulerService: SchedulerService,
    private readonly repository: StatsEventRepository,
    private readonly statsEventQueue: StatsEventQueue,
    private readonly appConfigService: AppConfigService,
    @Optional() private readonly alertReporter?: AlertReporter,
  ) {}

  @Cron('*/10 * * * *', { name: TASK_NAME, timeZone: 'Asia/Shanghai' })
  async handle(): Promise<void> {
    try {
      const run = await this.schedulerService.runExclusive(TASK_NAME, LOCK_TTL_MS, () => this.requeueStale(new Date()));
      if (run.executed) {
        this.schedulerService.logTaskExecution(TASK_NAME, `${run.result} records requeued`);
      }
    } catch (error) {
      this.schedulerService.logTaskError(TASK_NAME, error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** 返回实际入队的记录数；userIds 限定扫描的用户 */
  async requeueStale(now: Date, userIds?: number[]): Promise<number> {
    if (!this.statsEventQueue.enabled) {
      return 0;
    }
    const gradedBefore = new Date(now.getTime() - PENDING_GRACE_MS);
    let cursor: PendingRecordCursor | null = null;
    let requeued = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const records = await this.repository.findStalePendingRecords(gradedBefore, cursor, BATCH_SIZE, userIds);
      for (const record of records) {
        if (await this.statsEventQueue.requeueRecord(record.id)) {
          requeued += 1;
        }
      }
      if (records.length < BATCH_SIZE) {
        break;
      }
      cursor = records[records.length - 1];
    }
    await this.alertIfBacklogged(requeued);
    return requeued;
  }

  private async alertIfBacklogged(requeued: number): Promise<void> {
    const threshold = await this.threshold();
    if (requeued <= threshold || !this.alertReporter) {
      return;
    }
    try {
      await this.alertReporter.raise(
        STATS_COMPENSATION_ALERT_TYPE,
        AlertLevel.WARN,
        `统计补偿单次重新入队 ${requeued} 条，超过阈值 ${threshold}`,
        { requeued, threshold },
      );
    } catch (error) {
      this.logger.error(`Failed to raise stats compensation alert: ${String(error)}`);
    }
  }

  private async threshold(): Promise<number> {
    const thresholds = await this.appConfigService
      .getValue<Record<string, unknown>>('alert.thresholds')
      .catch(() => undefined);
    const value = thresholds?.[STATS_COMPENSATION_THRESHOLD_KEY];
    return typeof value === 'number' && value >= 0 ? value : DEFAULT_STATS_COMPENSATION_THRESHOLD;
  }
}
