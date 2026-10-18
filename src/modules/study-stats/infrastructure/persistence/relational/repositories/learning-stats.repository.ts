import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import {
  DailyStatDelta,
  DailyTotals,
  KnowledgeResultData,
  LearningStatsRepository,
  MockSessionDuration,
  SubtreeAnswerAggregate,
  SubtreeQuestionCount,
} from '../../learning-stats.repository';
import { UserDailyStatEntity } from '../entities/user-daily-stat.entity';
import { UserKnowledgeStatEntity } from '../entities/user-knowledge-stat.entity';
import { UserDailyStatMapper } from '../mappers/user-daily-stat.mapper';
import { UserKnowledgeStatMapper } from '../mappers/user-knowledge-stat.mapper';
import { UserDailyStat } from '../../../../domain/user-daily-stat';
import { UserKnowledgeStat } from '../../../../domain/user-knowledge-stat';
import { RECENT_RESULTS_LIMIT } from '../../../../domain/mastery';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { TransactionHandle, entityManagerOf } from '../../../../../../common/database/transaction-handle';

const MOCK_DURATION_LOCK_NAMESPACE = 'stats:mock-duration:';

@Injectable()
export class LearningStatsRelationalRepository implements LearningStatsRepository {
  constructor(
    @InjectRepository(UserKnowledgeStatEntity)
    private readonly knowledgeStatRepository: Repository<UserKnowledgeStatEntity>,
    @InjectRepository(UserDailyStatEntity)
    private readonly dailyStatRepository: Repository<UserDailyStatEntity>,
  ) {}

  async applyKnowledgeResult(handle: TransactionHandle, data: KnowledgeResultData): Promise<void> {
    const ids = [...new Set(data.knowledgePointIds)].sort();
    if (ids.length === 0) {
      return;
    }
    const result = data.isCorrect ? 1 : 0;
    await entityManagerOf(handle).query(
      `INSERT INTO "user_knowledge_stat" AS s
         ("userId", "knowledgePointId", "answered", "correct", "recentResults", "lastAnsweredAt")
       SELECT $1, kp.id, 1, $3::int, ARRAY[$3::int]::smallint[], $4
       FROM unnest($2::uuid[]) WITH ORDINALITY AS kp(id, ord)
       ORDER BY kp.ord
       ON CONFLICT ("userId", "knowledgePointId") DO UPDATE SET
         "answered" = s."answered" + 1,
         "correct" = s."correct" + EXCLUDED."correct",
         "recentResults" = (array_append(s."recentResults", $3::int::smallint))[greatest(cardinality(s."recentResults") + 2 - $5::int, 1):],
         "lastAnsweredAt" = GREATEST(s."lastAnsweredAt", EXCLUDED."lastAnsweredAt"),
         "updatedAt" = now()`,
      [data.userId, ids, result, data.answeredAt, RECENT_RESULTS_LIMIT],
    );
  }

  async addDailyStat(handle: TransactionHandle, delta: DailyStatDelta): Promise<void> {
    await entityManagerOf(handle).query(
      `INSERT INTO "user_daily_stat" AS d ("userId", "date", "subjectId", "answered", "correct", "durationSec")
       VALUES ($1, $2::date, $3, $4, $5, $6)
       ON CONFLICT ("userId", "date", "subjectId") DO UPDATE SET
         "answered" = d."answered" + EXCLUDED."answered",
         "correct" = d."correct" + EXCLUDED."correct",
         "durationSec" = d."durationSec" + EXCLUDED."durationSec",
         "updatedAt" = now()`,
      [delta.userId, delta.date, delta.subjectId, delta.answered, delta.correct, delta.durationSec],
    );
  }

  async claimMockSessionDuration(
    handle: TransactionHandle,
    sessionId: string,
    recordId: string,
  ): Promise<NullableType<MockSessionDuration>> {
    const manager = entityManagerOf(handle);
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${MOCK_DURATION_LOCK_NAMESPACE}${sessionId}`]);
    const rows: (MockSessionDuration & { date: string | null })[] = await manager.query(
      `SELECT s."subjectId", s."durationSec",
              (s."submittedAt" AT TIME ZONE 'Asia/Shanghai')::date::text AS "date"
       FROM "practice_session" AS s
       WHERE s."id" = $1
         AND NOT EXISTS (
           SELECT 1 FROM "answer_record" AS r
           WHERE r."sessionId" = s."id" AND r."id" <> $2 AND r."statsAppliedAt" IS NOT NULL
         )`,
      [sessionId, recordId],
    );
    const row = rows[0];
    return row?.date ? { date: row.date, subjectId: row.subjectId, durationSec: row.durationSec } : null;
  }

  async findLeafStats(userId: number, subjectId: string): Promise<UserKnowledgeStat[]> {
    const entities = await this.knowledgeStatRepository
      .createQueryBuilder('s')
      .innerJoin('knowledge_point', 'kp', 'kp.id = s.knowledgePointId')
      .where('s.userId = :userId', { userId })
      .andWhere('kp.subjectId = :subjectId', { subjectId })
      .andWhere('kp.isLeaf = true')
      .orderBy('kp.path', 'ASC')
      .getMany();
    return entities.map((entity) => UserKnowledgeStatMapper.toDomain(entity));
  }

  aggregateSubtreeAnswers(userId: number, subjectId: string): Promise<SubtreeAnswerAggregate[]> {
    return this.knowledgeStatRepository.query(
      `WITH node_records AS (
         SELECT DISTINCT node."id" AS "nodeId", r."id", r."isCorrect", r."statsAppliedAt", r."questionId",
                q."status" = 'PUBLISHED' AS "isPublished"
         FROM "answer_record" AS r
         INNER JOIN "question" AS q ON q."id" = r."questionId"
         INNER JOIN "question_knowledge_point" AS link ON link."questionId" = r."questionId"
         INNER JOIN "knowledge_point" AS leaf ON leaf."id" = link."knowledgePointId" AND leaf."subjectId" = $2
         INNER JOIN "knowledge_point" AS node
           ON node."subjectId" = leaf."subjectId" AND leaf."path" LIKE node."path" || '%'
         WHERE r."userId" = $1 AND r."statsAppliedAt" IS NOT NULL AND r."isCorrect" IS NOT NULL
       ),
       ranked AS (
         SELECT *, row_number() OVER (PARTITION BY "nodeId" ORDER BY "statsAppliedAt" DESC, "id" DESC) AS "rank"
         FROM node_records
       )
       SELECT "nodeId" AS "knowledgePointId",
              count(*)::int AS "answered",
              count(*) FILTER (WHERE "isCorrect")::int AS "correct",
              count(*) FILTER (WHERE "rank" <= $3)::int AS "recentAnswered",
              count(*) FILTER (WHERE "rank" <= $3 AND "isCorrect")::int AS "recentCorrect",
              count(DISTINCT "questionId") FILTER (WHERE "isPublished")::int AS "answeredQuestionCount"
       FROM ranked GROUP BY "nodeId"`,
      [userId, subjectId, RECENT_RESULTS_LIMIT],
    );
  }

  countSubtreeQuestions(subjectId: string): Promise<SubtreeQuestionCount[]> {
    return this.knowledgeStatRepository.query(
      `SELECT node."id" AS "knowledgePointId", count(DISTINCT q."id")::int AS "questionCount"
       FROM "knowledge_point" AS node
       INNER JOIN "knowledge_point" AS leaf
         ON leaf."subjectId" = node."subjectId" AND leaf."path" LIKE node."path" || '%'
       INNER JOIN "question_knowledge_point" AS link ON link."knowledgePointId" = leaf."id"
       INNER JOIN "question" AS q ON q."id" = link."questionId" AND q."status" = 'PUBLISHED'
       WHERE node."subjectId" = $1
       GROUP BY node."id"`,
      [subjectId],
    );
  }

  async findDailyStats(userId: number, from: string, to: string): Promise<UserDailyStat[]> {
    const entities = await this.dailyStatRepository.find({
      where: { userId, date: Between(from, to) },
      order: { date: 'ASC', subjectId: 'ASC' },
    });
    return entities.map((entity) => UserDailyStatMapper.toDomain(entity));
  }

  async sumDailyStats(userId: number, filter: { examId?: string; date?: string }): Promise<DailyTotals> {
    const rows: DailyTotals[] = await this.dailyStatRepository.query(
      `SELECT COALESCE(sum(d."answered"), 0)::int AS "answered",
              COALESCE(sum(d."correct"), 0)::int AS "correct",
              COALESCE(sum(d."durationSec"), 0)::int AS "durationSec"
       FROM "user_daily_stat" AS d
       WHERE d."userId" = $1
         AND ($2::date IS NULL OR d."date" = $2::date)
         AND ($3::uuid IS NULL OR d."subjectId" IN (SELECT s."id" FROM "subject" AS s WHERE s."examId" = $3::uuid))`,
      [userId, filter.date ?? null, filter.examId ?? null],
    );
    return rows[0];
  }
}
