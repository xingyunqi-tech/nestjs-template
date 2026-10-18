import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { CheckInRepository, CheckinStreak, GoalProgress } from '../../check-in.repository';
import { StudyCheckinEntity } from '../entities/study-checkin.entity';
import { StudyCheckinMapper } from '../mappers/study-checkin.mapper';
import { CheckinReason, StudyCheckin } from '../../../../domain/study-checkin';
import { QuestionType } from '../../../../../questions/domain/question-type';
import { PracticeMode } from '../../../../../practice/domain/practice-mode';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { TransactionHandle, entityManagerOf } from '../../../../../../common/database/transaction-handle';

const SUBJECTIVE_TYPES = [QuestionType.SHORT_ANSWER, QuestionType.ESSAY];
const CHECKIN_LOCK_NAMESPACE = 'stats:checkin:';

@Injectable()
export class CheckInRelationalRepository implements CheckInRepository {
  constructor(
    @InjectRepository(StudyCheckinEntity)
    private readonly repository: Repository<StudyCheckinEntity>,
  ) {}

  async lockUserDate(handle: TransactionHandle, userId: number, date: string): Promise<void> {
    await entityManagerOf(handle).query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `${CHECKIN_LOCK_NAMESPACE}${userId}:${date}`,
    ]);
  }

  async hasCheckin(handle: TransactionHandle, userId: number, date: string): Promise<boolean> {
    const rows: unknown[] = await entityManagerOf(handle).query(
      `SELECT 1 FROM "study_checkin" WHERE "userId" = $1 AND "date" = $2::date`,
      [userId, date],
    );
    return rows.length > 0;
  }

  async isDailySessionDone(handle: TransactionHandle, userId: number, date: string): Promise<boolean> {
    const rows: unknown[] = await entityManagerOf(handle).query(
      `SELECT 1 FROM "practice_session" AS s
       WHERE s."userId" = $1 AND s."mode" = $3 AND s."dailyDate" = $2::date
         AND cardinality(s."questionIds") > 0
         AND NOT EXISTS (
           SELECT 1 FROM unnest(s."questionIds") AS item("questionId")
           INNER JOIN "question" AS q ON q."id" = item."questionId"
           LEFT JOIN "answer_record" AS r ON r."sessionId" = s."id" AND r."questionId" = item."questionId"
           WHERE CASE
             WHEN q."type" = ANY($4::varchar[]) THEN r."answer" IS NULL OR (
               r."statDate" IS DISTINCT FROM s."dailyDate"
               AND (r."answeredAt" AT TIME ZONE 'Asia/Shanghai')::date <> s."dailyDate"
             )
             ELSE r."isCorrect" IS NULL OR r."statDate" IS DISTINCT FROM s."dailyDate"
           END
         )
       LIMIT 1`,
      [userId, date, PracticeMode.DAILY, SUBJECTIVE_TYPES],
    );
    return rows.length > 0;
  }

  async findGoalProgress(handle: TransactionHandle, userId: number, date: string): Promise<NullableType<GoalProgress>> {
    const rows: GoalProgress[] = await entityManagerOf(handle).query(
      `SELECT p."dailyGoal",
              COALESCE((
                SELECT sum(d."answered") FROM "user_daily_stat" AS d
                INNER JOIN "subject" AS s ON s."id" = d."subjectId"
                WHERE d."userId" = p."userId" AND d."date" = $2::date AND s."examId" = p."examId"
              ), 0)::int AS "answered"
       FROM "user_exam_profile" AS p
       WHERE p."userId" = $1 AND p."isCurrent"`,
      [userId, date],
    );
    return rows[0] ?? null;
  }

  async insert(handle: TransactionHandle, userId: number, date: string, reason: CheckinReason): Promise<boolean> {
    const rows: unknown[] = await entityManagerOf(handle).query(
      `INSERT INTO "study_checkin" ("userId", "date", "reason") VALUES ($1, $2::date, $3)
       ON CONFLICT ("userId", "date") DO NOTHING
       RETURNING "id"`,
      [userId, date, reason],
    );
    return rows.length > 0;
  }

  async findByDateRange(userId: number, from: string, to: string): Promise<StudyCheckin[]> {
    const entities = await this.repository.find({
      where: { userId, date: Between(from, to) },
      order: { date: 'ASC' },
    });
    return entities.map((entity) => StudyCheckinMapper.toDomain(entity));
  }

  async findStreak(userId: number, today: string): Promise<CheckinStreak> {
    const rows: CheckinStreak[] = await this.repository.query(
      `WITH islands AS (
         SELECT "date", "date" + (row_number() OVER (ORDER BY "date" DESC))::int AS "island"
         FROM "study_checkin" WHERE "userId" = $1 AND "date" <= $2::date
       ),
       anchor AS (
         SELECT EXISTS (SELECT 1 FROM islands WHERE "date" = $2::date) AS "checkedInToday"
       )
       SELECT anchor."checkedInToday",
              (SELECT count(*)::int FROM islands WHERE "island" = (
                 SELECT i."island" FROM islands AS i
                 WHERE i."date" = CASE WHEN anchor."checkedInToday" THEN $2::date ELSE $2::date - 1 END
               )) AS "streakDays"
       FROM anchor`,
      [userId, today],
    );
    return rows[0];
  }
}
