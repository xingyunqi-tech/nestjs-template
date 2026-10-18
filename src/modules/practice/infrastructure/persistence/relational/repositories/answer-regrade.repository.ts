import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  AnswerRegradeRepository,
  RegradeChange,
  RegradeRecord,
  RegradeScope,
  SessionScoreDelta,
} from '../../answer-regrade.repository';
import { PracticeSessionStatus } from '../../../../domain/practice-session';
import { TransactionHandle, entityManagerOf } from '../../../../../../common/database/transaction-handle';

const PENDING = `r."questionId" = $2 AND r."questionVersion" < $3 AND (NOT $4::boolean OR r."isCorrect" IS NOT NULL)`;

type RegradeRow = Omit<RegradeRecord, 'paperScore'> & { paperScore: number | string | null };

@Injectable()
export class AnswerRegradeRelationalRepository implements AnswerRegradeRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async raiseInProgressSessionVersions(
    handle: TransactionHandle,
    questionId: string,
    version: number,
  ): Promise<number> {
    const [rows]: [unknown[], number] = await entityManagerOf(handle).query(
      `UPDATE "practice_session"
       SET "questionVersions" = jsonb_set("questionVersions", ARRAY[$1::text], to_jsonb($2::int)), "updatedAt" = now()
       WHERE "status" = $3 AND "questionIds" @> ARRAY[$1::uuid]
         AND COALESCE(("questionVersions" ->> $1::text)::int, 0) < $2
       RETURNING "id"`,
      [questionId, version, PracticeSessionStatus.IN_PROGRESS],
    );
    return rows.length;
  }

  async countPendingUsers(scope: RegradeScope, errataId: string): Promise<number> {
    const [row]: { count: number }[] = await this.dataSource.query(
      `SELECT count(DISTINCT r."userId")::int AS "count" FROM "answer_record" AS r
       WHERE r."userId" > $1 AND ${PENDING}
         AND NOT EXISTS (
           SELECT 1 FROM "errata_user" AS processed WHERE processed."errataId" = $5 AND processed."userId" = r."userId"
         )`,
      [0, scope.questionId, scope.toVersion, scope.objective, errataId],
    );
    return row.count;
  }

  async findPendingUsers(scope: RegradeScope, afterUserId: number, limit: number): Promise<number[]> {
    const rows: { userId: number }[] = await this.dataSource.query(
      `SELECT DISTINCT r."userId" FROM "answer_record" AS r
       WHERE r."userId" > $1 AND ${PENDING}
       ORDER BY 1
       LIMIT $5`,
      [afterUserId, scope.questionId, scope.toVersion, scope.objective, limit],
    );
    return rows.map((row) => row.userId);
  }

  async lockPendingRecords(handle: TransactionHandle, userId: number, scope: RegradeScope): Promise<RegradeRecord[]> {
    const manager = entityManagerOf(handle);
    const params = [userId, scope.questionId, scope.toVersion, scope.objective];
    await manager.query(
      `SELECT s."id" FROM "practice_session" AS s
       WHERE s."id" IN (SELECT r."sessionId" FROM "answer_record" AS r WHERE r."userId" = $1 AND ${PENDING})
       ORDER BY s."id"
       FOR NO KEY UPDATE`,
      params,
    );
    const rows: RegradeRow[] = await manager.query(
      `SELECT r."id", r."sessionId", r."answer", r."isCorrect", r."isPartial", r."score"::float8 AS "score",
              r."gradedAt", r."statDate"::text AS "statDate", r."statsAppliedAt", r."firstForQuestion",
              s."mode", s."subjectId", pq."score"::float8 AS "paperScore", p."multiScoringRule"
       FROM "answer_record" AS r
       INNER JOIN "practice_session" AS s ON s."id" = r."sessionId"
       LEFT JOIN "paper" AS p ON p."id" = s."paperId"
       LEFT JOIN "paper_question" AS pq ON pq."paperId" = s."paperId" AND pq."questionId" = r."questionId"
       WHERE r."userId" = $1 AND ${PENDING}
       ORDER BY r."id"
       FOR UPDATE OF r`,
      params,
    );
    return rows.map((row) => ({ ...row, paperScore: row.paperScore === null ? null : Number(row.paperScore) }));
  }

  async writeRegrades(
    handle: TransactionHandle,
    ids: string[],
    changes: RegradeChange[],
    toVersion: number,
  ): Promise<void> {
    const manager = entityManagerOf(handle);
    if (changes.length > 0) {
      await manager.query(
        `UPDATE "answer_record" AS r
         SET "isCorrect" = g."isCorrect", "isPartial" = g."isPartial", "score" = g."score"
         FROM jsonb_to_recordset($1::jsonb) AS g("id" uuid, "isCorrect" boolean, "isPartial" boolean, "score" numeric)
         WHERE r."id" = g."id"`,
        [JSON.stringify(changes)],
      );
    }
    if (ids.length > 0) {
      await manager.query(
        `UPDATE "answer_record" SET "questionVersion" = $2, "updatedAt" = now() WHERE "id" = ANY($1::uuid[])`,
        [ids, toVersion],
      );
    }
  }

  async adjustSessionScores(handle: TransactionHandle, deltas: SessionScoreDelta[]): Promise<void> {
    const changed = deltas.filter((delta) => delta.correct !== 0 || delta.scoreCents !== 0);
    if (changed.length === 0) {
      return;
    }
    await entityManagerOf(handle).query(
      `UPDATE "practice_session" AS s
       SET "correctCount" = GREATEST(s."correctCount" + d."correct", 0),
           "score" = CASE WHEN s."score" IS NULL THEN NULL ELSE s."score" + d."scoreCents"::numeric / 100 END,
           "updatedAt" = now()
       FROM jsonb_to_recordset($1::jsonb) AS d("sessionId" uuid, "correct" int, "scoreCents" int)
       WHERE s."id" = d."sessionId"`,
      [JSON.stringify(changed)],
    );
  }
}
