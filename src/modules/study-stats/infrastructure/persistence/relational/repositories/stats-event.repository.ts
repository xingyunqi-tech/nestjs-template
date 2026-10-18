import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError } from 'typeorm';
import { PendingRecordCursor, StatsEventRepository, StatsEventTransaction } from '../../stats-event.repository';
import { StatsRecord } from '../../../../domain/stats-record';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { TransactionHandle, createTransactionHandle } from '../../../../../../common/database/transaction-handle';

const DEADLOCK_DETECTED = '40P01';
const UNIQUE_VIOLATION = '23505';
const MAX_TRANSACTION_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 20;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof QueryFailedError && (error.driverError as { code?: string })?.code === code;
}

/** TypeORM 对 UPDATE 返回 [rows, affected] */
function affectedOf(result: unknown): number {
  return Array.isArray(result) && typeof result[1] === 'number' ? result[1] : 0;
}

class RelationalStatsEventTransaction implements StatsEventTransaction {
  readonly handle: TransactionHandle;

  constructor(private readonly manager: EntityManager) {
    this.handle = createTransactionHandle(manager);
  }

  async claimRecord(id: string): Promise<boolean> {
    const result: unknown = await this.manager.query(
      `UPDATE "answer_record" SET "statsAppliedAt" = now()
       WHERE "id" = $1 AND "statsAppliedAt" IS NULL AND "isCorrect" IS NOT NULL`,
      [id],
    );
    return affectedOf(result) > 0;
  }

  async findRecord(id: string): Promise<NullableType<StatsRecord>> {
    const rows: StatsRecord[] = await this.manager.query(
      `SELECT r."id", r."sessionId", r."userId", s."subjectId", s."mode", r."questionId", q."type" AS "questionType",
              q."subjectId" AS "questionSubjectId",
              ARRAY(
                SELECT link."knowledgePointId" FROM "question_knowledge_point" AS link
                JOIN "knowledge_point" AS kp ON kp."id" = link."knowledgePointId"
                WHERE link."questionId" = r."questionId" AND kp."isLeaf"
                ORDER BY link."knowledgePointId"
              ) AS "knowledgePointIds",
              r."answer", r."isCorrect", r."isPartial", r."selfAssessment", r."durationSec", r."gradedAt",
              r."statDate"::text AS "statDate", r."firstForQuestion"
       FROM "answer_record" AS r
       JOIN "practice_session" AS s ON s."id" = r."sessionId"
       JOIN "question" AS q ON q."id" = r."questionId"
       WHERE r."id" = $1 AND r."isCorrect" IS NOT NULL`,
      [id],
    );
    return rows[0] ? { ...rows[0] } : null;
  }

  async markFirstForQuestion(
    record: Pick<StatsRecord, 'id' | 'userId' | 'questionId' | 'isCorrect'>,
  ): Promise<boolean> {
    await this.manager.query('SAVEPOINT "first_for_question"');
    try {
      const result: unknown = await this.manager.query(
        `UPDATE "answer_record" SET "firstForQuestion" = true
         WHERE "id" = $1 AND NOT "firstForQuestion"
           AND NOT EXISTS (
             SELECT 1 FROM "answer_record" AS first
             WHERE first."userId" = $2 AND first."questionId" = $3 AND first."firstForQuestion"
           )`,
        [record.id, record.userId, record.questionId],
      );
      const marked = affectedOf(result) > 0;
      if (marked) {
        await this.manager.query(
          `UPDATE "question" SET "statAnswered" = "statAnswered" + 1, "statCorrect" = "statCorrect" + $2
           WHERE "id" = $1`,
          [record.questionId, record.isCorrect ? 1 : 0],
        );
      }
      await this.manager.query('RELEASE SAVEPOINT "first_for_question"');
      return marked;
    } catch (error) {
      if (!hasErrorCode(error, UNIQUE_VIOLATION)) {
        throw error;
      }
      await this.manager.query('ROLLBACK TO SAVEPOINT "first_for_question"');
      return false;
    }
  }
}

@Injectable()
export class StatsEventRelationalRepository implements StatsEventRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findRecordUserId(id: string): Promise<NullableType<number>> {
    const rows: { userId: number }[] = await this.dataSource.query(
      `SELECT "userId" FROM "answer_record" WHERE "id" = $1`,
      [id],
    );
    return rows[0]?.userId ?? null;
  }

  findPendingSessionRecords(sessionId: string): Promise<Pick<StatsRecord, 'id' | 'userId'>[]> {
    return this.dataSource.query(
      `SELECT "id", "userId" FROM "answer_record"
       WHERE "sessionId" = $1 AND "statsAppliedAt" IS NULL AND "isCorrect" IS NOT NULL
       ORDER BY "gradedAt", "id"`,
      [sessionId],
    );
  }

  findStalePendingRecords(
    gradedBefore: Date,
    after: PendingRecordCursor | null,
    limit: number,
    userIds?: number[],
  ): Promise<PendingRecordCursor[]> {
    return this.dataSource.query(
      `SELECT "id", "gradedAt"::text AS "gradedAt" FROM "answer_record"
       WHERE "statsAppliedAt" IS NULL AND "isCorrect" IS NOT NULL AND "gradedAt" < $1
         AND ($2::timestamptz IS NULL OR ("gradedAt", "id") > ($2::timestamptz, $3::uuid))
         AND ($5::int[] IS NULL OR "userId" = ANY($5::int[]))
       ORDER BY "gradedAt", "id"
       LIMIT $4`,
      [gradedBefore, after?.gradedAt ?? null, after?.id ?? null, limit, userIds ?? null],
    );
  }

  async transaction<T>(work: (tx: StatsEventTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.dataSource.transaction((manager) => work(new RelationalStatsEventTransaction(manager)));
      } catch (error) {
        if (!hasErrorCode(error, DEADLOCK_DETECTED) || attempt >= MAX_TRANSACTION_ATTEMPTS) {
          throw error;
        }
        await sleep(RETRY_BACKOFF_MS * attempt + Math.floor(Math.random() * RETRY_BACKOFF_MS));
      }
    }
  }
}
