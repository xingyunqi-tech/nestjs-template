import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { DailySessionProgress, DailySetUsageRepository } from '../../daily-set-usage.repository';
import { DailyQuestionSetEntity } from '../entities/daily-question-set.entity';
import { DailyQuestionSetMapper } from '../mappers/daily-question-set.mapper';
import { DailyQuestionSet } from '../../../../domain/daily-question-set';
import { lockDailyQuestionSet } from '../../../../../../infrastructure/database/utils/daily-question-set-lock';

@Injectable()
export class DailySetUsageRelationalRepository implements DailySetUsageRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  replaceIfUnused(subjectId: string, date: string, questionIds: string[]): Promise<DailyQuestionSet | null> {
    return this.dataSource.transaction(async (manager) => {
      await lockDailyQuestionSet(manager, subjectId, date);
      const sessions: unknown[] = await manager.query(
        `SELECT 1 FROM "practice_session" WHERE "mode" = 'DAILY' AND "subjectId" = $1 AND "dailyDate" = $2 LIMIT 1`,
        [subjectId, date],
      );
      if (sessions.length > 0) {
        return null;
      }
      await manager
        .createQueryBuilder()
        .insert()
        .into(DailyQuestionSetEntity)
        .values({ subjectId, date, questionIds })
        .orUpdate(['questionIds', 'updatedAt'], ['subjectId', 'date'])
        .execute();
      return DailyQuestionSetMapper.toDomain(
        await manager.findOneByOrFail(DailyQuestionSetEntity, { subjectId, date }),
      );
    });
  }

  async findSessionProgress(userId: number, subjectId: string, date: string): Promise<DailySessionProgress | null> {
    const [row]: DailySessionProgress[] = await this.dataSource.query(
      `SELECT "id" AS "sessionId", cardinality("questionIds") AS "questionCount",
              "answeredCount" AS "answeredCount", "correctCount" AS "correctCount"
       FROM "practice_session"
       WHERE "mode" = 'DAILY' AND "userId" = $1 AND "subjectId" = $2 AND "dailyDate" = $3`,
      [userId, subjectId, date],
    );
    return row ?? null;
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
