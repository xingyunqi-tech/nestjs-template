import { Injectable, Logger } from '@nestjs/common';
import { DailyTotals, LearningStatsRepository } from './infrastructure/persistence/learning-stats.repository';
import { LearningStatsUpdater } from './ports/learning-stats.updater';
import { KnowledgeMasteryService } from './knowledge-mastery.service';
import { StatsRecord } from './domain/stats-record';
import { UserDailyStat } from './domain/user-daily-stat';
import { statDateOf } from './domain/stat-date';
import { PracticeMode } from '../practice/domain/practice-mode';
import { TransactionHandle } from '../../common/database/transaction-handle';

@Injectable()
export class LearningStatsService implements LearningStatsUpdater {
  private readonly logger = new Logger(LearningStatsService.name);

  constructor(
    private readonly repository: LearningStatsRepository,
    private readonly knowledgeMasteryService: KnowledgeMasteryService,
  ) {}

  /** MOCK 的用时按会话计入交卷当天且每会话只计一次，其他模式按单题用时累加 */
  async apply(handle: TransactionHandle, record: StatsRecord): Promise<void> {
    const date = statDateOf(record);
    await this.repository.applyKnowledgeResult(handle, {
      userId: record.userId,
      knowledgePointIds: record.knowledgePointIds,
      isCorrect: record.isCorrect,
      answeredAt: record.gradedAt ?? new Date(),
    });
    const isMock = record.mode === PracticeMode.MOCK;
    await this.repository.addDailyStat(handle, {
      userId: record.userId,
      date,
      subjectId: record.subjectId,
      answered: 1,
      correct: record.isCorrect ? 1 : 0,
      durationSec: isMock ? 0 : Math.max(record.durationSec, 0),
    });
    if (!isMock) {
      return;
    }
    const session = await this.repository.claimMockSessionDuration(handle, record.sessionId, record.id);
    if (session && session.durationSec > 0) {
      await this.repository.addDailyStat(handle, {
        userId: record.userId,
        date: session.date,
        subjectId: session.subjectId,
        answered: 0,
        correct: 0,
        durationSec: session.durationSec,
      });
    }
  }

  async afterCommit(record: StatsRecord): Promise<void> {
    try {
      await this.knowledgeMasteryService.invalidate(record.userId);
    } catch (error) {
      this.logger.warn(
        `Failed to invalidate knowledge cache of user ${record.userId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  findDailyStats(userId: number, from: string, to: string): Promise<UserDailyStat[]> {
    return this.repository.findDailyStats(userId, from, to);
  }

  sumDailyStats(userId: number, filter: { examId?: string; date?: string }): Promise<DailyTotals> {
    return this.repository.sumDailyStats(userId, filter);
  }
}
