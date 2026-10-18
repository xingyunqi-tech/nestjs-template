import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PaperAttemptRepository, PaperScores } from '../../paper-attempt.repository';

@Injectable()
export class PaperAttemptRelationalRepository implements PaperAttemptRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findUserScores(userId: number, paperIds: string[]): Promise<Map<string, PaperScores>> {
    if (paperIds.length === 0) {
      return new Map();
    }
    const rows: { paperId: string; lastScore: string | null; bestScore: string | null }[] = await this.dataSource.query(
      `SELECT s."paperId" AS "paperId",
              (ARRAY_AGG(s."score" ORDER BY s."submittedAt" DESC, s."id" DESC))[1] AS "lastScore",
              MAX(s."score") AS "bestScore"
       FROM "practice_session" AS s
       WHERE s."userId" = $1 AND s."paperId" = ANY($2::uuid[]) AND s."mode" = 'MOCK'
         AND s."status" = 'SUBMITTED' AND s."score" IS NOT NULL
       GROUP BY s."paperId"`,
      [userId, paperIds],
    );
    const toNumber = (value: string | null): number | null => (value === null ? null : Number(value));
    return new Map(
      rows.map((row) => [row.paperId, { lastScore: toNumber(row.lastScore), bestScore: toNumber(row.bestScore) }]),
    );
  }

  async findAnsweredRootIds(userId: number, subjectId: string, since: Date | null): Promise<string[]> {
    const rows: { rootId: string }[] = await this.dataSource.query(
      `SELECT DISTINCT COALESCE(q."parentId", q."id") AS "rootId"
       FROM "answer_record" AS r
       INNER JOIN "question" AS q ON q."id" = r."questionId"
       WHERE r."userId" = $1 AND q."subjectId" = $2 AND r."answer" IS NOT NULL
         AND ($3::timestamptz IS NULL OR r."answeredAt" >= $3::timestamptz)`,
      [userId, subjectId, since],
    );
    return rows.map((row) => row.rootId);
  }
}
