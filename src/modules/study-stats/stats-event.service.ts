import { Injectable, Logger } from '@nestjs/common';
import { LockService } from '../../infrastructure/redis/lock.service';
import { StatsEventRepository } from './infrastructure/persistence/stats-event.repository';
import { WrongBookUpdater } from './ports/wrong-book.updater';
import { LearningStatsUpdater } from './ports/learning-stats.updater';
import { CheckInEvaluator } from './ports/check-in.evaluator';

const USER_LOCK_TTL_MS = 60_000;

export const statsUserLockKey = (userId: number): string => `stats:user:${userId}`;

export type StatsJobResult = 'done' | 'locked';

@Injectable()
export class StatsEventService {
  private readonly logger = new Logger(StatsEventService.name);

  constructor(
    private readonly repository: StatsEventRepository,
    private readonly lockService: LockService,
    private readonly wrongBookUpdater: WrongBookUpdater,
    private readonly learningStatsUpdater: LearningStatsUpdater,
    private readonly checkInEvaluator: CheckInEvaluator,
  ) {}

  async processRecord(recordId: string): Promise<StatsJobResult> {
    const userId = await this.repository.findRecordUserId(recordId);
    if (userId === null) {
      return 'done';
    }
    return this.withUserLock(userId, async () => {
      await this.applyRecord(recordId);
    });
  }

  /** 逐条处理，单条失败不影响其余记录，全部处理后抛出首个错误 */
  async processSession(sessionId: string): Promise<StatsJobResult> {
    const records = await this.repository.findPendingSessionRecords(sessionId);
    if (records.length === 0) {
      return 'done';
    }
    return this.withUserLock(records[0].userId, async () => {
      let firstError: Error | null = null;
      for (const record of records) {
        try {
          await this.applyRecord(record.id);
        } catch (error) {
          firstError ??= error instanceof Error ? error : new Error(String(error));
          this.logger.error(
            `Failed to apply stats for record ${record.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (firstError) {
        throw firstError;
      }
    });
  }

  async processCheckIn(userId: number, date: string): Promise<StatsJobResult> {
    return this.withUserLock(userId, () =>
      this.repository.transaction((tx) => this.checkInEvaluator.evaluate(tx.handle, userId, date)),
    );
  }

  /** 返回是否计入；已计入或未判分时跳过 */
  async applyRecord(recordId: string): Promise<boolean> {
    const applied = await this.repository.transaction(async (tx) => {
      if (!(await tx.claimRecord(recordId))) {
        return null;
      }
      const record = await tx.findRecord(recordId);
      if (!record) {
        return null;
      }
      await this.wrongBookUpdater.apply(tx.handle, record);
      await this.learningStatsUpdater.apply(tx.handle, record);
      await this.checkInEvaluator.apply(tx.handle, record);
      await tx.markFirstForQuestion(record);
      return record;
    });
    if (!applied) {
      return false;
    }
    await this.learningStatsUpdater.afterCommit(applied);
    return true;
  }

  private async withUserLock(userId: number, work: () => Promise<void>): Promise<StatsJobResult> {
    const key = statsUserLockKey(userId);
    const token = await this.lockService.tryAcquire(key, USER_LOCK_TTL_MS);
    if (!token) {
      return 'locked';
    }
    try {
      await work();
      return 'done';
    } finally {
      await this.lockService.release(key, token);
    }
  }
}
