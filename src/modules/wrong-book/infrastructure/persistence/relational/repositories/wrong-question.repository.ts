import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WrongQuestionEntity } from '../entities/wrong-question.entity';
import { WrongQuestionMapper } from '../mappers/wrong-question.mapper';
import {
  CorrectAnswerData,
  WrongAnswerData,
  WrongBookCounts,
  WrongBookFilter,
  WrongQuestionRepository,
} from '../../wrong-question.repository';
import { WrongQuestion, WrongQuestionStatus } from '../../../../domain/wrong-question';
import { QuestionStatus } from '../../../../../questions/domain/question-status';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';
import { TransactionHandle, entityManagerOf } from '../../../../../../common/database/transaction-handle';

@Injectable()
export class WrongQuestionRelationalRepository implements WrongQuestionRepository {
  constructor(
    @InjectRepository(WrongQuestionEntity)
    private readonly repository: Repository<WrongQuestionEntity>,
  ) {}

  async recordWrong(handle: TransactionHandle, data: WrongAnswerData): Promise<void> {
    await entityManagerOf(handle).query(
      `INSERT INTO "wrong_question" AS w
         ("userId", "questionId", "subjectId", "wrongCount", "consecutiveCorrect", "lastWrongAnswer",
          "firstWrongAt", "lastWrongAt", "status")
       VALUES ($1, $2, $3, 1, 0, $4::jsonb, $5, $5, $6)
       ON CONFLICT ("userId", "questionId") DO UPDATE SET
         "wrongCount" = w."wrongCount" + 1,
         "consecutiveCorrect" = 0,
         "status" = EXCLUDED."status",
         "masteredAt" = NULL,
         "firstWrongAt" = LEAST(w."firstWrongAt", EXCLUDED."firstWrongAt"),
         "lastWrongAnswer" = CASE WHEN EXCLUDED."lastWrongAt" >= w."lastWrongAt"
           THEN EXCLUDED."lastWrongAnswer" ELSE w."lastWrongAnswer" END,
         "lastWrongAt" = GREATEST(w."lastWrongAt", EXCLUDED."lastWrongAt"),
         "updatedAt" = now()`,
      [
        data.userId,
        data.questionId,
        data.subjectId,
        data.answer === null ? null : JSON.stringify(data.answer),
        data.wrongAt,
        WrongQuestionStatus.ACTIVE,
      ],
    );
  }

  async rebuildFromRecords(
    handle: TransactionHandle,
    data: Pick<WrongAnswerData, 'userId' | 'questionId' | 'subjectId'>,
  ): Promise<void> {
    const manager = entityManagerOf(handle);
    await manager.query(`SELECT "id" FROM "wrong_question" WHERE "userId" = $1 AND "questionId" = $2 FOR UPDATE`, [
      data.userId,
      data.questionId,
    ]);
    const rows: { wrongCount: number }[] = await manager.query(
      `WITH wrong AS (
         SELECT r."id", r."answer", COALESCE(r."gradedAt", r."answeredAt") AS "wrongAt"
         FROM "answer_record" AS r
         WHERE r."userId" = $1 AND r."questionId" = $2 AND r."statsAppliedAt" IS NOT NULL AND r."isCorrect" = false
       ),
       latest AS (SELECT "answer" FROM wrong ORDER BY "wrongAt" DESC, "id" DESC LIMIT 1)
       INSERT INTO "wrong_question" AS w
         ("userId", "questionId", "subjectId", "wrongCount", "consecutiveCorrect", "lastWrongAnswer",
          "firstWrongAt", "lastWrongAt", "status")
       SELECT $1, $2, $3, count(*)::int, 0, (SELECT "answer" FROM latest), min("wrongAt"), max("wrongAt"), $4
       FROM wrong
       HAVING count(*) > 0
       ON CONFLICT ("userId", "questionId") DO UPDATE SET
         "wrongCount" = EXCLUDED."wrongCount",
         "lastWrongAnswer" = EXCLUDED."lastWrongAnswer",
         "firstWrongAt" = EXCLUDED."firstWrongAt",
         "lastWrongAt" = EXCLUDED."lastWrongAt",
         "updatedAt" = now()
       RETURNING w."wrongCount"`,
      [data.userId, data.questionId, data.subjectId, WrongQuestionStatus.ACTIVE],
    );
    if (rows.length === 0) {
      await manager.query(`DELETE FROM "wrong_question" WHERE "userId" = $1 AND "questionId" = $2`, [
        data.userId,
        data.questionId,
      ]);
    }
  }

  async recordCorrect(handle: TransactionHandle, data: CorrectAnswerData): Promise<void> {
    await entityManagerOf(handle).query(
      `UPDATE "wrong_question" SET
         "consecutiveCorrect" = "consecutiveCorrect" + 1,
         "lastCorrectDate" = $3::date,
         "status" = CASE WHEN "consecutiveCorrect" + 1 >= $4 THEN $6 ELSE "status" END,
         "masteredAt" = CASE WHEN "consecutiveCorrect" + 1 >= $4 THEN now() ELSE "masteredAt" END,
         "updatedAt" = now()
       WHERE "userId" = $1 AND "questionId" = $2 AND "status" = $5
         AND ("lastCorrectDate" IS NULL OR "lastCorrectDate" < $3::date)`,
      [
        data.userId,
        data.questionId,
        data.statDate,
        data.masterThreshold,
        WrongQuestionStatus.ACTIVE,
        WrongQuestionStatus.MASTERED,
      ],
    );
  }

  async findActivePublishedQuestionIds(userId: number, subjectId: string): Promise<string[]> {
    const rows: { questionId: string }[] = await this.repository.query(
      `SELECT w."questionId" FROM "wrong_question" AS w
       INNER JOIN "question" AS q ON q."id" = w."questionId"
       LEFT JOIN "question" AS parent ON parent."id" = q."parentId"
       WHERE w."userId" = $1 AND w."subjectId" = $2 AND w."status" = $3
         AND q."status" = $4 AND (parent."id" IS NULL OR parent."status" = $4)
       ORDER BY w."lastWrongAt" DESC, w."id"`,
      [userId, subjectId, WrongQuestionStatus.ACTIVE, QuestionStatus.PUBLISHED],
    );
    return rows.map((row) => row.questionId);
  }

  async findQuestionIdsInBook(userId: number, questionIds: string[]): Promise<string[]> {
    if (questionIds.length === 0) {
      return [];
    }
    const rows: { questionId: string }[] = await this.repository.query(
      `SELECT "questionId" FROM "wrong_question" WHERE "userId" = $1 AND "questionId" = ANY($2::uuid[])`,
      [userId, questionIds],
    );
    return rows.map((row) => row.questionId);
  }

  async findManyWithPaginationAndCount(
    filter: WrongBookFilter,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: WrongQuestion[]; total: number }> {
    const query = this.repository
      .createQueryBuilder('w')
      .where('w.userId = :userId', { userId: filter.userId })
      .andWhere('w.status = :status', { status: filter.status });
    if (filter.subjectId) {
      query.andWhere('w.subjectId = :subjectId', { subjectId: filter.subjectId });
    }
    if (filter.knowledgePointId) {
      query.andWhere(
        `EXISTS (
          SELECT 1 FROM "question_knowledge_point" AS links
          INNER JOIN "knowledge_point" AS kp ON kp."id" = links."knowledgePointId"
          WHERE links."questionId" = "w"."questionId"
            AND kp."path" LIKE (SELECT "path" FROM "knowledge_point" WHERE "id" = :knowledgePointId) || '%'
        )`,
        { knowledgePointId: filter.knowledgePointId },
      );
    }
    if (filter.minWrongCount !== undefined) {
      query.andWhere('w.wrongCount >= :minWrongCount', { minWrongCount: filter.minWrongCount });
    }
    if (filter.maxWrongCount !== undefined) {
      query.andWhere('w.wrongCount <= :maxWrongCount', { maxWrongCount: filter.maxWrongCount });
    }
    if (filter.lastWrongFrom) {
      query.andWhere('w.lastWrongAt >= :lastWrongFrom', { lastWrongFrom: filter.lastWrongFrom });
    }
    if (filter.lastWrongTo) {
      query.andWhere('w.lastWrongAt < :lastWrongTo', { lastWrongTo: filter.lastWrongTo });
    }
    const [entities, total] = await query
      .orderBy(`w.${filter.sortBy}`, filter.order)
      .addOrderBy('w.id', 'ASC')
      .skip((paginationOptions.page - 1) * paginationOptions.limit)
      .take(paginationOptions.limit)
      .getManyAndCount();
    return { data: entities.map((entity) => WrongQuestionMapper.toDomain(entity)), total };
  }

  async countSummary(userId: number, weekStart: Date, subjectId?: string): Promise<WrongBookCounts> {
    const params = [userId, subjectId ?? null, WrongQuestionStatus.ACTIVE];
    const scope = `w."userId" = $1 AND ($2::uuid IS NULL OR w."subjectId" = $2::uuid)`;
    const [[totals], bySubject, byKnowledgePoint] = await Promise.all([
      this.repository.query<Pick<WrongBookCounts, 'activeCount' | 'weeklyAdded' | 'weeklyMastered'>[]>(
        `SELECT
           count(*) FILTER (WHERE w."status" = $3)::int AS "activeCount",
           count(*) FILTER (WHERE w."firstWrongAt" >= $4)::int AS "weeklyAdded",
           count(*) FILTER (WHERE w."status" = $5 AND w."masteredAt" >= $4)::int AS "weeklyMastered"
         FROM "wrong_question" AS w WHERE ${scope}`,
        [...params, weekStart, WrongQuestionStatus.MASTERED],
      ),
      this.repository.query<WrongBookCounts['bySubject']>(
        `SELECT w."subjectId", count(*)::int AS "activeCount" FROM "wrong_question" AS w
         WHERE ${scope} AND w."status" = $3
         GROUP BY w."subjectId" ORDER BY w."subjectId"`,
        params,
      ),
      this.repository.query<WrongBookCounts['byKnowledgePoint']>(
        `SELECT node."id" AS "knowledgePointId", count(DISTINCT w."questionId")::int AS "activeCount"
         FROM "wrong_question" AS w
         INNER JOIN "question_knowledge_point" AS links ON links."questionId" = w."questionId"
         INNER JOIN "knowledge_point" AS leaf ON leaf."id" = links."knowledgePointId"
         INNER JOIN "knowledge_point" AS node
           ON node."subjectId" = leaf."subjectId" AND leaf."path" LIKE node."path" || '%'
         WHERE ${scope} AND w."status" = $3
         GROUP BY node."id" ORDER BY node."id"`,
        params,
      ),
    ]);
    return { ...totals, bySubject, byKnowledgePoint };
  }

  async master(userId: number, questionId: string): Promise<NullableType<WrongQuestion>> {
    await this.repository
      .createQueryBuilder()
      .update()
      .set({ status: WrongQuestionStatus.MASTERED, masteredAt: () => 'now()' })
      .where('userId = :userId AND questionId = :questionId AND status = :status', {
        userId,
        questionId,
        status: WrongQuestionStatus.ACTIVE,
      })
      .execute();
    return this.findOne(userId, questionId);
  }

  async restore(userId: number, questionId: string): Promise<NullableType<WrongQuestion>> {
    await this.repository
      .createQueryBuilder()
      .update()
      .set({ status: WrongQuestionStatus.ACTIVE, consecutiveCorrect: 0, masteredAt: null })
      .where('userId = :userId AND questionId = :questionId AND status = :status', {
        userId,
        questionId,
        status: WrongQuestionStatus.MASTERED,
      })
      .execute();
    return this.findOne(userId, questionId);
  }

  private async findOne(userId: number, questionId: string): Promise<NullableType<WrongQuestion>> {
    const entity = await this.repository.findOne({ where: { userId, questionId } });
    return entity ? WrongQuestionMapper.toDomain(entity) : null;
  }
}
