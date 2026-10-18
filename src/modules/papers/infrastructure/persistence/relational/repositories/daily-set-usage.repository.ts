import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DailySetUsageRepository } from '../../daily-set-usage.repository';
import { lockDailyQuestionSet } from '../../../../../../infrastructure/database/utils/daily-question-set-lock';

@Injectable()
export class DailySetUsageRelationalRepository implements DailySetUsageRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async hasSessions(subjectId: string, date: string): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM "practice_session" WHERE "mode" = 'DAILY' AND "subjectId" = $1 AND "dailyDate" = $2 LIMIT 1`,
      [subjectId, date],
    );
    return rows.length > 0;
  }

  runLocked<T>(subjectId: string, date: string, work: () => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await lockDailyQuestionSet(manager, subjectId, date);
      return work();
    });
  }

  async findInProgressMockQuestionIds(userId: number, questionIds: string[]): Promise<string[]> {
    if (questionIds.length === 0) {
      return [];
    }
    const rows: { questionId: string }[] = await this.dataSource.query(
      `SELECT DISTINCT item AS "questionId"
       FROM "practice_session" AS s, unnest(s."questionIds") AS item
       WHERE s."userId" = $1 AND s."mode" = 'MOCK' AND s."status" = 'IN_PROGRESS' AND item = ANY($2::uuid[])`,
      [userId, questionIds],
    );
    return rows.map((row) => row.questionId);
  }
}
