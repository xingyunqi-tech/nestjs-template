import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Not, QueryFailedError, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { PracticeSessionEntity } from '../entities/practice-session.entity';
import { AnswerRecordEntity } from '../entities/answer-record.entity';
import { PracticeSessionMapper } from '../mappers/practice-session.mapper';
import { AnswerRecordMapper } from '../mappers/answer-record.mapper';
import {
  AnswerRecordChanges,
  CreateMockSessionData,
  CreatePracticeSessionData,
  DailySessionKey,
  InsertAnswerRecordData,
  MockPaperMissingError,
  MockSubmission,
  PercentileSample,
  PracticeSessionFilter,
  PracticeSessionRepository,
  PracticeTransaction,
  RecordGrade,
  SessionCounterDelta,
} from '../../practice-session.repository';
import { PracticeMode } from '../../../../domain/practice-mode';
import { PracticeSession, PracticeSessionStatus, SubmitType } from '../../../../domain/practice-session';
import { AnswerRecord } from '../../../../domain/answer-record';
import { SessionAnswerContext } from '../../../../domain/answer-visibility';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { lockDailyQuestionSet } from '../../../../../../infrastructure/database/utils/daily-question-set-lock';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';

const DEADLOCK_DETECTED = '40P01';
const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';
const MAX_TRANSACTION_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 20;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof QueryFailedError && (error.driverError as { code?: string })?.code === code;
}

function isDeadlock(error: unknown): boolean {
  return hasErrorCode(error, DEADLOCK_DETECTED);
}

function recordColumns(changes: AnswerRecordChanges): QueryDeepPartialEntity<AnswerRecordEntity> {
  const { score, ...rest } = changes;
  return {
    ...(rest as QueryDeepPartialEntity<AnswerRecordEntity>),
    ...(score !== undefined && { score: score === null ? null : score.toFixed(2) }),
  };
}

async function inProgressMockQuestionIds(
  manager: EntityManager,
  userId: number,
  questionIds: string[] | null,
): Promise<string[]> {
  const rows: { questionId: string }[] = await manager.query(
    `SELECT DISTINCT item AS "questionId"
     FROM "practice_session" AS s, unnest(s."questionIds") AS item
     WHERE s."userId" = $1 AND s."mode" = $2 AND s."status" = $3
       AND ($4::uuid[] IS NULL OR item = ANY($4::uuid[]))`,
    [userId, PracticeMode.MOCK, PracticeSessionStatus.IN_PROGRESS, questionIds],
  );
  return rows.map((row) => row.questionId);
}

class RelationalPracticeTransaction implements PracticeTransaction {
  constructor(private readonly manager: EntityManager) {}

  async lockSessionForWrite(id: string): Promise<NullableType<PracticeSession>> {
    const entity = await this.manager
      .createQueryBuilder(PracticeSessionEntity, 's')
      .setLock('for_no_key_update')
      .where('s.id = :id', { id })
      .getOne();
    return entity ? PracticeSessionMapper.toDomain(entity) : null;
  }

  findInProgressMockQuestionIds(userId: number, questionIds: string[]): Promise<string[]> {
    return questionIds.length === 0
      ? Promise.resolve([])
      : inProgressMockQuestionIds(this.manager, userId, questionIds);
  }

  async findRecordsForUpdate(sessionId: string, questionIds: string[]): Promise<AnswerRecord[]> {
    if (questionIds.length === 0) {
      return [];
    }
    const entities = await this.manager
      .createQueryBuilder(AnswerRecordEntity, 'r')
      .setLock('pessimistic_write')
      .where('r."sessionId" = :sessionId', { sessionId })
      .andWhere('r."questionId" IN (:...questionIds)', { questionIds })
      .orderBy('r."questionId"', 'ASC')
      .getMany();
    return entities.map((entity) => AnswerRecordMapper.toDomain(entity));
  }

  async insertRecord(data: InsertAnswerRecordData): Promise<NullableType<AnswerRecord>> {
    const result = await this.manager
      .createQueryBuilder()
      .insert()
      .into(AnswerRecordEntity)
      .values(recordColumns(data))
      .orIgnore()
      .returning(['id'])
      .execute();
    const [row] = result.raw as { id: string }[];
    if (!row) {
      return null;
    }
    const entity = await this.manager.findOneByOrFail(AnswerRecordEntity, { id: row.id });
    return AnswerRecordMapper.toDomain(entity);
  }

  async updateRecord(id: string, changes: AnswerRecordChanges): Promise<AnswerRecord> {
    await this.manager.update(AnswerRecordEntity, { id }, recordColumns(changes));
    return AnswerRecordMapper.toDomain(await this.manager.findOneByOrFail(AnswerRecordEntity, { id }));
  }

  async adjustSessionCounters(id: string, delta: SessionCounterDelta): Promise<void> {
    await this.manager
      .createQueryBuilder()
      .update(PracticeSessionEntity)
      .set({
        answeredCount: () => `"answeredCount" + ${Math.trunc(delta.answered)}`,
        correctCount: () => `"correctCount" + ${Math.trunc(delta.correct)}`,
        durationSec: () => `"durationSec" + ${Math.trunc(delta.durationSec)}`,
        lastActiveAt: () => 'now()',
      })
      .where('id = :id', { id })
      .execute();
  }

  async markFirstAttempt(session: Pick<PracticeSession, 'id' | 'userId' | 'paperId'>): Promise<boolean> {
    if (!session.paperId) {
      return false;
    }
    await this.manager.query('SAVEPOINT "first_attempt"');
    try {
      const result = await this.manager
        .createQueryBuilder()
        .update(PracticeSessionEntity)
        .set({ isFirstAttempt: true })
        .where('id = :id AND NOT "isFirstAttempt"', { id: session.id })
        .andWhere(
          `NOT EXISTS (
            SELECT 1 FROM "practice_session" AS first
            WHERE first."userId" = :userId AND first."paperId" = :paperId AND first."isFirstAttempt"
          )`,
          { userId: session.userId, paperId: session.paperId },
        )
        .execute();
      const marked = (result.affected ?? 0) > 0;
      if (marked) {
        await this.manager.query(`UPDATE "paper" SET "attemptCount" = "attemptCount" + 1 WHERE "id" = $1`, [
          session.paperId,
        ]);
      }
      await this.manager.query('RELEASE SAVEPOINT "first_attempt"');
      return marked;
    } catch (error) {
      if (!hasErrorCode(error, UNIQUE_VIOLATION)) {
        throw error;
      }
      await this.manager.query('ROLLBACK TO SAVEPOINT "first_attempt"');
      return false;
    }
  }

  async gradeRecords(grades: RecordGrade[], gradedAt: Date, statDate: string): Promise<void> {
    if (grades.length === 0) {
      return;
    }
    await this.manager.query(
      `UPDATE "answer_record" AS r
       SET "isCorrect" = g."isCorrect", "isPartial" = g."isPartial", "score" = g."score",
           "gradedAt" = $2, "statDate" = $3, "updatedAt" = now()
       FROM jsonb_to_recordset($1::jsonb) AS g("id" uuid, "isCorrect" boolean, "isPartial" boolean, "score" numeric)
       WHERE r."id" = g."id"`,
      [JSON.stringify(grades), gradedAt, statDate],
    );
  }

  async setActiveDevice(id: string, deviceId: string): Promise<void> {
    await this.manager
      .createQueryBuilder()
      .update(PracticeSessionEntity)
      .set({ activeDeviceId: deviceId, lastActiveAt: () => 'now()' })
      .where('id = :id', { id })
      .execute();
  }

  async closeMock(id: string, submission: MockSubmission): Promise<boolean> {
    const values: QueryDeepPartialEntity<PracticeSessionEntity> =
      submission.status === PracticeSessionStatus.ABANDONED
        ? { status: submission.status }
        : {
            status: submission.status,
            submitType: submission.submitType,
            submittedAt: submission.submittedAt,
            durationSec: submission.durationSec,
            score: submission.score.toFixed(2),
            correctCount: submission.correctCount,
            scoringScheme: submission.scoringScheme,
            totalScore: submission.totalScore.toFixed(2),
          };
    const result = await this.manager
      .createQueryBuilder()
      .update(PracticeSessionEntity)
      .set(values)
      .where('id = :id AND status = :inProgress', { id, inProgress: PracticeSessionStatus.IN_PROGRESS })
      .execute();
    return (result.affected ?? 0) > 0;
  }
}

@Injectable()
export class PracticeSessionRelationalRepository implements PracticeSessionRepository {
  constructor(
    @InjectRepository(PracticeSessionEntity)
    private readonly sessionRepository: Repository<PracticeSessionEntity>,
    @InjectRepository(AnswerRecordEntity)
    private readonly recordRepository: Repository<AnswerRecordEntity>,
  ) {}

  async create(data: CreatePracticeSessionData): Promise<PracticeSession> {
    const entity = await this.sessionRepository.save(
      this.sessionRepository.create(PracticeSessionMapper.toPersistence(data)),
    );
    return (await this.findById(entity.id))!;
  }

  async insertMockIfAbsent(data: CreateMockSessionData): Promise<NullableType<PracticeSession>> {
    const values = PracticeSessionMapper.toPersistence(data);
    values.startedAt = data.startedAt;
    values.lastActiveAt = data.startedAt;
    const result = await this.sessionRepository
      .createQueryBuilder()
      .insert()
      .into(PracticeSessionEntity)
      .values(values)
      .orIgnore()
      .returning(['id'])
      .execute()
      .catch((error: unknown) => {
        throw hasErrorCode(error, FOREIGN_KEY_VIOLATION) ? new MockPaperMissingError() : error;
      });
    const [row] = result.raw as { id: string }[];
    return row ? this.findById(row.id) : null;
  }

  async findInProgressMock(userId: number, paperId: string): Promise<NullableType<PracticeSession>> {
    const entity = await this.sessionRepository.findOneBy({
      userId,
      paperId,
      mode: PracticeMode.MOCK,
      status: PracticeSessionStatus.IN_PROGRESS,
    });
    return entity ? PracticeSessionMapper.toDomain(entity) : null;
  }

  async findDueMockIds(now: Date, limit: number): Promise<string[]> {
    const rows = await this.sessionRepository
      .createQueryBuilder('s')
      .select('s.id', 'id')
      .where('s.status = :inProgress AND s.mode = :mock AND s."autoSubmitAt" <= :now', {
        inProgress: PracticeSessionStatus.IN_PROGRESS,
        mock: PracticeMode.MOCK,
        now,
      })
      .orderBy('s.autoSubmitAt', 'ASC')
      .limit(limit)
      .getRawMany<{ id: string }>();
    return rows.map((row) => row.id);
  }

  async findPercentileSample(
    session: Pick<PracticeSession, 'userId' | 'paperId' | 'scoringScheme'>,
    score: number,
  ): Promise<PercentileSample> {
    if (!session.paperId || !session.scoringScheme) {
      return { below: 0, total: 0 };
    }
    const [row]: { below: number; total: number }[] = await this.sessionRepository.query(
      `SELECT COUNT(*) FILTER (WHERE s."score" < $4)::int AS "below", COUNT(*)::int AS "total"
       FROM "practice_session" AS s
       WHERE s."paperId" = $1 AND s."scoringScheme" = $2 AND s."isFirstAttempt" AND s."status" = $5
         AND s."score" IS NOT NULL AND NOT s."pendingGrading" AND s."userId" <> $3`,
      [session.paperId, session.scoringScheme, session.userId, score, PracticeSessionStatus.SUBMITTED],
    );
    return row;
  }

  async findDaily(key: DailySessionKey): Promise<NullableType<PracticeSession>> {
    const entity = await this.sessionRepository.findOneBy({ ...key, mode: PracticeMode.DAILY });
    return entity ? PracticeSessionMapper.toDomain(entity) : null;
  }

  createDaily(
    key: DailySessionKey,
    build: () => Promise<CreatePracticeSessionData | null>,
  ): Promise<NullableType<PracticeSession>> {
    return this.sessionRepository.manager.transaction(async (manager) => {
      await lockDailyQuestionSet(manager, key.subjectId, key.dailyDate);
      const existing = await manager.findOneBy(PracticeSessionEntity, { ...key, mode: PracticeMode.DAILY });
      if (existing) {
        return PracticeSessionMapper.toDomain(existing);
      }
      const data = await build();
      if (!data) {
        return null;
      }
      const saved = await manager.save(
        manager.create(PracticeSessionEntity, PracticeSessionMapper.toPersistence(data)),
      );
      return PracticeSessionMapper.toDomain(await manager.findOneByOrFail(PracticeSessionEntity, { id: saved.id }));
    });
  }

  async findById(id: string): Promise<NullableType<PracticeSession>> {
    const entity = await this.sessionRepository.findOneBy({ id });
    return entity ? PracticeSessionMapper.toDomain(entity) : null;
  }

  async findRecords(sessionId: string, questionIds?: string[]): Promise<AnswerRecord[]> {
    if (questionIds?.length === 0) {
      return [];
    }
    const entities = await this.recordRepository.find({
      where: { sessionId, ...(questionIds && { questionId: In(questionIds) }) },
    });
    return entities.map((entity) => AnswerRecordMapper.toDomain(entity));
  }

  async findManyWithPaginationAndCount(
    filter: PracticeSessionFilter,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: PracticeSession[]; total: number }> {
    const [entities, total] = await this.sessionRepository.findAndCount({
      where: {
        userId: filter.userId,
        ...(filter.mode && { mode: filter.mode }),
        ...(filter.status && { status: filter.status }),
      },
      order: { startedAt: 'DESC', id: 'DESC' },
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
    });
    return { data: entities.map((entity) => PracticeSessionMapper.toDomain(entity)), total };
  }

  async findOngoing(userId: number, limit: number, excludeModes: PracticeMode[]): Promise<PracticeSession[]> {
    const entities = await this.sessionRepository.find({
      where: {
        userId,
        status: PracticeSessionStatus.IN_PROGRESS,
        ...(excludeModes.length > 0 && { mode: Not(In(excludeModes)) }),
      },
      order: { lastActiveAt: 'DESC', id: 'DESC' },
      take: limit,
    });
    return entities.map((entity) => PracticeSessionMapper.toDomain(entity));
  }

  findInProgressMockQuestionIds(userId: number): Promise<string[]> {
    return inProgressMockQuestionIds(this.sessionRepository.manager, userId, null);
  }

  async findWrongQuestionIds(session: PracticeSession): Promise<string[]> {
    const entities = await this.recordRepository.find({
      select: { questionId: true },
      where: { sessionId: session.id, isCorrect: false },
    });
    const wrong = new Set(entities.map((entity) => entity.questionId));
    return session.questionIds.filter((id) => wrong.has(id));
  }

  async findQuestionIdsInUserSessions(userId: number, questionIds: string[]): Promise<string[]> {
    if (questionIds.length === 0) {
      return [];
    }
    const rows: { id: string }[] = await this.sessionRepository.query(
      `SELECT candidate.id AS "id"
       FROM unnest($2::uuid[]) AS candidate(id)
       WHERE EXISTS (
         SELECT 1 FROM "practice_session" AS s
         WHERE s."userId" = $1 AND s."questionIds" @> ARRAY[candidate.id]
       )`,
      [userId, questionIds],
    );
    return rows.map((row) => row.id);
  }

  async findSessionAnswerContexts(
    userId: number,
    questionId: string,
  ): Promise<Required<Pick<SessionAnswerContext, 'session' | 'record'>>[]> {
    const rows: (Pick<PracticeSession, 'mode' | 'status'> & Pick<AnswerRecord, 'answer' | 'isCorrect'>)[] =
      await this.sessionRepository.query(
        `SELECT s."mode" AS "mode", s."status" AS "status", r."answer" AS "answer", r."isCorrect" AS "isCorrect"
         FROM "practice_session" AS s
         LEFT JOIN "answer_record" AS r ON r."sessionId" = s."id" AND r."questionId" = $2
         WHERE s."userId" = $1 AND s."questionIds" @> ARRAY[$2::uuid]
           AND (s."mode" = $3 OR (s."mode" = $4 AND s."status" = $5) OR r."answer" IS NOT NULL)
         ORDER BY r."answeredAt" DESC NULLS LAST, s."startedAt" DESC`,
        [userId, questionId, PracticeMode.MEMORIZE, PracticeMode.MOCK, PracticeSessionStatus.SUBMITTED],
      );
    return rows.map((row) => ({
      session: { mode: row.mode, status: row.status },
      record: { answer: row.answer, isCorrect: row.isCorrect },
    }));
  }

  async updateProgress(id: string, lastIndex: number): Promise<void> {
    await this.sessionRepository
      .createQueryBuilder()
      .update(PracticeSessionEntity)
      .set({ lastIndex, lastActiveAt: () => 'now()' })
      .where('id = :id', { id })
      .execute();
  }

  async closeInProgress(
    id: string,
    status: PracticeSessionStatus.SUBMITTED | PracticeSessionStatus.ABANDONED,
    submitType: SubmitType | null,
  ): Promise<boolean> {
    const result = await this.sessionRepository
      .createQueryBuilder()
      .update(PracticeSessionEntity)
      .set({
        status,
        submitType,
        ...(status === PracticeSessionStatus.SUBMITTED && { submittedAt: () => 'now()' }),
      })
      .where('id = :id AND status = :inProgress', { id, inProgress: PracticeSessionStatus.IN_PROGRESS })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  async abandonInactive(before: Date, excludedModes: PracticeMode[], batchSize: number): Promise<number> {
    let total = 0;
    for (;;) {
      const result = await this.sessionRepository
        .createQueryBuilder()
        .update(PracticeSessionEntity)
        .set({ status: PracticeSessionStatus.ABANDONED })
        .where(
          `id IN (
            SELECT s."id" FROM "practice_session" AS s
            WHERE s."status" = :inProgress AND s."lastActiveAt" < :before AND s."mode" <> ALL(:excludedModes)
            LIMIT :batchSize FOR UPDATE SKIP LOCKED
          )`,
        )
        .andWhere('status = :inProgress')
        .setParameters({ inProgress: PracticeSessionStatus.IN_PROGRESS, before, excludedModes, batchSize })
        .execute();
      const affected = result.affected ?? 0;
      total += affected;
      if (affected < batchSize) {
        return total;
      }
    }
  }

  async findInProgressMockIds(userId: number): Promise<string[]> {
    const rows = await this.sessionRepository.find({
      select: { id: true },
      where: { userId, mode: PracticeMode.MOCK, status: PracticeSessionStatus.IN_PROGRESS },
    });
    return rows.map((row) => row.id);
  }

  async removeByUser(userId: number): Promise<void> {
    await this.sessionRepository.delete({ userId });
  }

  async transaction<T>(work: (tx: PracticeTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.sessionRepository.manager.transaction((manager) =>
          work(new RelationalPracticeTransaction(manager)),
        );
      } catch (error) {
        if (!isDeadlock(error) || attempt >= MAX_TRANSACTION_ATTEMPTS) {
          throw error;
        }
        await sleep(RETRY_BACKOFF_MS * attempt + Math.floor(Math.random() * RETRY_BACKOFF_MS));
      }
    }
  }
}
