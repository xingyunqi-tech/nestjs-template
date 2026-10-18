// 需在独立的测试数据库与 Redis 上运行：会注册测试用户并写入考试、科目、知识点、题目与练习会话
import { NestExpressApplication } from '@nestjs/platform-express';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { md5 } from '../utils/constants';
import { createTestApp, randomIp } from '../utils/test-app';
import { UsersService } from '../../src/core/users/users.service';
import { PermissionsService } from '../../src/core/permissions/permissions.service';
import { RoleEnum } from '../../src/common/enums/roles/roles.enum';
import { StatsEventQueue } from '../../src/modules/study-stats/stats-event.queue';
import { StatsEventService } from '../../src/modules/study-stats/stats-event.service';
import { StatsCompensationTask } from '../../src/modules/study-stats/stats-compensation.task';
import { StatsEventRepository } from '../../src/modules/study-stats/infrastructure/persistence/stats-event.repository';
import { AlertReporter } from '../../src/infrastructure/alerting/alert-reporter';
import { STUDY_STATS_QUEUE } from '../../src/infrastructure/queue/study-stats-queue/study-stats-queue.constants';

process.env.THROTTLE_ENABLED = 'true';
process.env.THROTTLE_LIMIT = '1000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

type Account = { token: string; email: string; id: number };
type RecordRow = { id: string; statsAppliedAt: Date | null; firstForQuestion: boolean };

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

async function registerAndLogin(app: NestExpressApplication): Promise<Account> {
  const email = `stats.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = md5('Secret00');
  await api(app)
    .post('/api/v1/auth/email/register')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password, firstName: 'Stats', lastName: 'E2E' })
    .expect(200);
  const { body } = await api(app)
    .post('/api/v1/auth/email/login')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password })
    .expect(200);
  return { token: body.data.token as string, email, id: Number(body.data.user.id) };
}

async function setRole(app: NestExpressApplication, email: string, role: RoleEnum): Promise<void> {
  const usersService = app.get(UsersService);
  const found = await usersService.findByEmail(email);
  if (found) {
    await usersService.update(found.id, { role: { id: role } });
  }
}

async function waitFor<T>(probe: () => Promise<T | null | undefined>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('Stats events', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let admin: Account;
  let examId: string;
  let subjectId: string;
  const questionIds: string[] = [];
  let pointId: string;
  const unique = `${Date.now()}`;
  let seq = 0;

  const as = (account: Account) => {
    const withAuth = (req: request.Test): request.Test =>
      req.set('X-Forwarded-For', randomIp()).set('Authorization', `Bearer ${account.token}`);
    return {
      post: (path: string, body?: object) => withAuth(api(app).post(`/api/v1${path}`)).send(body ?? {}),
      put: (path: string, body?: object) => withAuth(api(app).put(`/api/v1${path}`)).send(body ?? {}),
    };
  };

  const startRandom = async (account: Account): Promise<string> => {
    const { body } = await as(account)
      .post('/practice/sessions', { subjectId, mode: 'RANDOM', count: 10, deviceId: 'device-1' })
      .expect(200);
    return body.data.id as string;
  };

  const answer = (account: Account, sessionId: string, questionId: string, keys: string[]) =>
    as(account)
      .put(`/practice/sessions/${sessionId}/answers`, {
        deviceId: 'device-1',
        answers: [{ questionId, answer: { keys }, clientSeq: (seq += 1), clientAnsweredAt: new Date().toISOString() }],
      })
      .expect(200);

  const findRecord = async (sessionId: string, questionId: string): Promise<RecordRow> =>
    (
      await dataSource.query(
        `SELECT "id", "statsAppliedAt", "firstForQuestion" FROM "answer_record"
         WHERE "sessionId" = $1 AND "questionId" = $2`,
        [sessionId, questionId],
      )
    )[0];

  const questionStats = async (questionId: string): Promise<{ statAnswered: number; statCorrect: number }> =>
    (await dataSource.query(`SELECT "statAnswered", "statCorrect" FROM "question" WHERE "id" = $1`, [questionId]))[0];

  const waitApplied = (recordId: string): Promise<RecordRow> =>
    waitFor(async () => {
      const rows: RecordRow[] = await dataSource.query(
        `SELECT "id", "statsAppliedAt", "firstForQuestion" FROM "answer_record" WHERE "id" = $1`,
        [recordId],
      );
      return rows[0]?.statsAppliedAt ? rows[0] : null;
    });

  /** 发布空操作，记录保持未计入 */
  const withoutPublishing = () => vi.spyOn(app.get(StatsEventQueue), 'publishRecord').mockResolvedValue(undefined);

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await app.get(PermissionsService).refreshCache();
    admin = await registerAndLogin(app);
    await setRole(app, admin.email, RoleEnum.admin);

    const exam = await as(admin).post('/admin/exams', { name: 'E2E 统计考试', category: 'CIVIL_SERVICE' }).expect(200);
    examId = exam.body.data.id;
    await as(admin).post(`/admin/exams/${examId}/publish`).expect(200);
    const subject = await as(admin).post('/admin/subjects', { examId, name: '行测' }).expect(200);
    subjectId = subject.body.data.id;
    await as(admin).post(`/admin/subjects/${subjectId}/publish`).expect(200);
    const point = await as(admin)
      .post('/admin/knowledge-points', { subjectId, parentId: null, name: '常识' })
      .expect(200);
    pointId = point.body.data.id as string;
    for (const name of ['甲', '乙', '丙']) {
      const { body } = await as(admin)
        .post('/admin/questions', {
          subjectId,
          type: 'SINGLE',
          stem: `统计${name} ${unique}`,
          options: ['A', 'B', 'C'].map((key) => ({ key, content: key })),
          answer: { keys: ['B'] },
          knowledgePointIds: [pointId],
        })
        .expect(200);
      await as(admin).post(`/admin/questions/${body.data.id}/submit`).expect(200);
      await as(admin).post(`/admin/questions/${body.data.id}/publish`).expect(200);
      questionIds.push(body.data.id as string);
    }
  }, 120_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      if (subjectId) {
        await dataSource.query(`DELETE FROM "practice_session" WHERE "subjectId" = $1`, [subjectId]);
        const owned = `SELECT "id" FROM "question" WHERE "subjectId" = $1`;
        await dataSource.query(`DELETE FROM "question_version" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(`DELETE FROM "question" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "knowledge_point" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "subject" WHERE "id" = $1`, [subjectId]);
      }
      if (examId) {
        await dataSource.query(`DELETE FROM "exam" WHERE "id" = $1`, [examId]);
      }
      await setRole(app, admin.email, RoleEnum.user);
    } finally {
      await app?.close();
    }
  });

  it('should count question stats through the queue after immediate grading without recounting duplicates or redos', async () => {
    const [questionId] = questionIds;
    const user = await registerAndLogin(app);
    const publishSpy = vi.spyOn(app.get(StatsEventQueue), 'publishRecord');
    const sessionId = await startRandom(user);

    await answer(user, sessionId, questionId, ['B']);
    const { id: recordId } = await findRecord(sessionId, questionId);
    expect(publishSpy).toHaveBeenCalledWith(recordId);

    const applied = await waitApplied(recordId);
    expect(applied.firstForQuestion).toBe(true);
    expect(await questionStats(questionId)).toEqual({ statAnswered: 1, statCorrect: 1 });

    await app.get(StatsEventQueue).publishRecord(recordId);
    const queue = app.get<Queue>(getQueueToken(STUDY_STATS_QUEUE));
    await waitFor(async () => !(await queue.getJob(recordId)));
    await expect(app.get(StatsEventService).processRecord(recordId)).resolves.toBe('done');
    expect(await questionStats(questionId)).toEqual({ statAnswered: 1, statCorrect: 1 });

    const redoId = await startRandom(user);
    await answer(user, redoId, questionId, ['A']);
    const redo = await waitApplied((await findRecord(redoId, questionId)).id);
    expect(redo.firstForQuestion).toBe(false);
    expect(await questionStats(questionId)).toEqual({ statAnswered: 1, statCorrect: 1 });
  });

  it('should treat a first answer blocked by an uncommitted first answer as not first after the unique conflict', async () => {
    const questionId = questionIds[1];
    const user = await registerAndLogin(app);
    withoutPublishing();
    const sessions = [await startRandom(user), await startRandom(user)];
    for (const sessionId of sessions) {
      await answer(user, sessionId, questionId, ['C']);
    }
    const [first, second] = await Promise.all(sessions.map((sessionId) => findRecord(sessionId, questionId)));

    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let markedFirst!: (marked: boolean) => void;
    const firstMarked = new Promise<boolean>((resolve) => (markedFirst = resolve));
    const holder = app.get(StatsEventRepository).transaction(async (tx) => {
      await tx.claimRecord(first.id);
      markedFirst(await tx.markFirstForQuestion({ id: first.id, userId: user.id, questionId, isCorrect: false }));
      await gate;
    });
    expect(await firstMarked).toBe(true);

    const contender = app.get(StatsEventService).applyRecord(second.id);
    await waitFor(async () => {
      const [{ count }]: { count: number }[] = await dataSource.query(
        `SELECT count(*)::int AS "count" FROM pg_stat_activity
         WHERE "datname" = current_database() AND "wait_event_type" = 'Lock'
           AND "query" LIKE '%SET "firstForQuestion" = true%'`,
      );
      return count > 0;
    });
    release();
    await holder;

    await expect(contender).resolves.toBe(true);
    expect((await findRecord(sessions[0], questionId)).firstForQuestion).toBe(true);
    const blocked = await findRecord(sessions[1], questionId);
    expect(blocked.firstForQuestion).toBe(false);
    expect(blocked.statsAppliedAt).not.toBeNull();
    expect(await questionStats(questionId)).toEqual({ statAnswered: 1, statCorrect: 0 });
  });

  it('should requeue and apply records graded over 10 minutes ago in the compensation task', async () => {
    const questionId = questionIds[2];
    const user = await registerAndLogin(app);
    withoutPublishing();
    const sessionId = await startRandom(user);
    await answer(user, sessionId, questionId, ['B']);
    const { id: recordId } = await findRecord(sessionId, questionId);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await findRecord(sessionId, questionId)).statsAppliedAt).toBeNull();
    vi.restoreAllMocks();

    const alertSpy = vi.spyOn(app.get(AlertReporter), 'raise').mockResolvedValue(null);
    const requeueSpy = vi.spyOn(app.get(StatsEventQueue), 'requeueRecord');
    const task = app.get(StatsCompensationTask);

    await expect(task.requeueStale(new Date(), [user.id])).resolves.toBe(0);
    expect(requeueSpy).not.toHaveBeenCalled();

    await dataSource.query(`UPDATE "answer_record" SET "gradedAt" = now() - interval '11 minutes' WHERE "id" = $1`, [
      recordId,
    ]);
    await expect(task.requeueStale(new Date(), [user.id])).resolves.toBe(1);
    expect(requeueSpy).toHaveBeenCalledWith(recordId);

    const applied = await waitApplied(recordId);
    expect(applied.firstForQuestion).toBe(true);
    expect(await questionStats(questionId)).toEqual({ statAnswered: 1, statCorrect: 1 });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('should reread the record with session, question type and leaf knowledge points', async () => {
    const user = await registerAndLogin(app);
    withoutPublishing();
    const sessionId = await startRandom(user);
    await answer(user, sessionId, questionIds[0], ['A']);
    const { id: recordId } = await findRecord(sessionId, questionIds[0]);

    const record = await app.get(StatsEventRepository).transaction((tx) => tx.findRecord(recordId));

    expect(record).toMatchObject({
      id: recordId,
      sessionId,
      userId: user.id,
      subjectId,
      mode: 'RANDOM',
      questionId: questionIds[0],
      questionType: 'SINGLE',
      knowledgePointIds: [pointId],
      isCorrect: false,
      isPartial: false,
      answer: { keys: ['A'] },
    });
    expect(record?.statDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
