// 需在独立的测试数据库与 Redis 上运行：会注册测试用户并写入考试、科目、知识点、题目、试卷、组卷规则、每日一练题组与模考会话
import { NestExpressApplication } from '@nestjs/platform-express';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { MockInstance } from 'vitest';
import { md5 } from '../utils/constants';
import { createTestApp, randomIp } from '../utils/test-app';
import { UsersService } from '../../src/core/users/users.service';
import { PermissionsService } from '../../src/core/permissions/permissions.service';
import { RoleEnum } from '../../src/common/enums/roles/roles.enum';
import { businessDate } from '../../src/modules/papers/domain/business-date';
import { AppConfigService } from '../../src/modules/config/config.service';
import { MockSubmitScheduler } from '../../src/modules/practice/mock-submit.scheduler';
import { MockExamService } from '../../src/modules/practice/mock-exam.service';
import { AutoSubmitMockSessionsTask } from '../../src/modules/practice/auto-submit-mock-sessions.task';
import { StatsEventPublisher } from '../../src/modules/practice/ports/stats-event.publisher';
import { PaperRepository } from '../../src/modules/papers/infrastructure/persistence/paper.repository';
import {
  MOCK_SUBMIT_JOB_NAME,
  MOCK_SUBMIT_QUEUE,
} from '../../src/infrastructure/queue/mock-submit-queue/mock-submit-queue.constants';

process.env.THROTTLE_ENABLED = 'true';
process.env.THROTTLE_LIMIT = '1000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

type Account = { token: string; email: string; id: number };
type CardItem = { questionId: string; answered: boolean; isCorrect: boolean | null; hiddenReason: string | null };
type ReportCard = { questionId: string; status: string | null; score: number | null };

const MINUTE = 60_000;

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

async function registerAndLogin(app: NestExpressApplication): Promise<Account> {
  const email = `mock.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = md5('Secret00');
  await api(app)
    .post('/api/v1/auth/email/register')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password, firstName: 'Mock', lastName: 'E2E' })
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

describe('Mock exams', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let admin: Account;
  let user: Account;
  let examId: string;
  let subjectId: string;
  let leaf: string;
  let paperId: string;
  const singles: string[] = [];
  let multiId: string;
  let shortId: string;
  let materialId: string;
  let subIds: string[];
  let syncWindowMin: number;
  let scheduleSpy: MockInstance<MockSubmitScheduler['schedule']>;
  let publishSpy: MockInstance<StatsEventPublisher['publishSession']>;
  const unique = `${Date.now()}`;

  const as = (account: Account | null) => {
    const withAuth = (req: request.Test): request.Test => {
      req.set('X-Forwarded-For', randomIp());
      return account ? req.set('Authorization', `Bearer ${account.token}`) : req;
    };
    return {
      get: (path: string) => withAuth(api(app).get(`/api/v1${path}`)),
      post: (path: string, body?: object) => withAuth(api(app).post(`/api/v1${path}`)).send(body ?? {}),
      put: (path: string, body?: object) => withAuth(api(app).put(`/api/v1${path}`)).send(body ?? {}),
      patch: (path: string, body?: object) => withAuth(api(app).patch(`/api/v1${path}`)).send(body ?? {}),
    };
  };

  async function createQuestion(body: object, publish: boolean): Promise<string> {
    const { body: response } = await as(admin).post('/admin/questions', body).expect(200);
    const id = response.data.id as string;
    if (publish) {
      await as(admin).post(`/admin/questions/${id}/submit`).expect(200);
      await as(admin).post(`/admin/questions/${id}/publish`).expect(200);
    }
    return id;
  }

  const options = ['A', 'B', 'C'].map((key) => ({ key, content: key }));
  const single = (stem: string, extra: object = {}): object => ({
    subjectId,
    type: 'SINGLE',
    stem: `${stem} ${unique}`,
    options,
    answer: { keys: ['B'] },
    analysis: `${stem}解析`,
    knowledgePointIds: [leaf],
    ...extra,
  });

  const startMock = (account: Account, deviceId: string, paper = paperId) =>
    as(account).post('/practice/sessions', { mode: 'MOCK', subjectId, paperId: paper, deviceId });

  const save = (
    account: Account,
    sessionId: string,
    deviceId: string,
    answers: { questionId: string; answer?: unknown; clientSeq: number; clientAnsweredAt?: string }[],
    offline?: boolean,
  ) =>
    as(account).put(`/practice/sessions/${sessionId}/answers`, {
      deviceId,
      offline,
      answers: answers.map((item) => ({ clientAnsweredAt: new Date().toISOString(), ...item })),
    });

  const detail = async (account: Account, sessionId: string) =>
    (await as(account).get(`/practice/sessions/${sessionId}`).expect(200)).body.data;

  const paperAttempts = async (): Promise<number> =>
    (await as(user).get(`/papers/${paperId}`).expect(200)).body.data.attemptCount as number;

  const setTimes = (sessionId: string, deadlineAt: Date, autoSubmitAt: Date, startedAt?: Date) =>
    dataSource.query(
      `UPDATE "practice_session" SET "deadlineAt" = $2, "autoSubmitAt" = $3, "startedAt" = COALESCE($4, "startedAt")
       WHERE "id" = $1`,
      [sessionId, deadlineAt, autoSubmitAt, startedAt ?? null],
    );

  const answerAll = async (account: Account, deviceId: string, keys: Record<string, unknown>): Promise<string> => {
    const { body } = await startMock(account, deviceId).expect(200);
    const items = Object.entries(keys).map(([questionId, answer], index) => ({
      questionId,
      answer,
      clientSeq: index + 1,
    }));
    if (items.length > 0) {
      await save(account, body.data.id, deviceId, items).expect(200);
    }
    return body.data.id as string;
  };

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await app.get(PermissionsService).refreshCache();
    scheduleSpy = vi.spyOn(app.get(MockSubmitScheduler), 'schedule').mockResolvedValue(undefined);
    publishSpy = vi.spyOn(app.get(StatsEventPublisher), 'publishSession');
    const window = await app.get(AppConfigService).getValue<number>('practice.offlineSyncWindowMin');
    syncWindowMin = typeof window === 'number' ? window : 5;

    user = await registerAndLogin(app);
    admin = await registerAndLogin(app);
    await setRole(app, admin.email, RoleEnum.admin);

    const exam = await as(admin).post('/admin/exams', { name: 'E2E 模考考试', category: 'CIVIL_SERVICE' }).expect(200);
    examId = exam.body.data.id;
    await as(admin).post(`/admin/exams/${examId}/publish`).expect(200);
    const subject = await as(admin).post('/admin/subjects', { examId, name: '行测' }).expect(200);
    subjectId = subject.body.data.id;
    await as(admin).post(`/admin/subjects/${subjectId}/publish`).expect(200);
    const branch = await as(admin).post('/admin/knowledge-points', { subjectId, parentId: null, name: '常识' });
    leaf = (
      await as(admin)
        .post('/admin/knowledge-points', { subjectId, parentId: branch.body.data.id, name: '法律' })
        .expect(200)
    ).body.data.id;

    for (const name of ['甲', '乙', '丙']) {
      singles.push(await createQuestion(single(`单选${name}`), true));
    }
    multiId = await createQuestion({ ...single('多选'), type: 'MULTIPLE', answer: { keys: ['A', 'C'] } }, true);
    shortId = await createQuestion(
      {
        subjectId,
        type: 'SHORT_ANSWER',
        stem: `简答 ${unique}`,
        answer: { reference: '参考答案', points: ['要点'] },
        knowledgePointIds: [leaf],
      },
      true,
    );
    materialId = await createQuestion(
      { subjectId, type: 'MATERIAL', stem: `资料 ${unique}`, material: `材料 ${unique}` },
      false,
    );
    subIds = [];
    for (const [index, name] of ['小题一', '小题二'].entries()) {
      subIds.push(await createQuestion({ ...single(name), parentId: materialId, sort: index }, false));
    }
    await as(admin).post(`/admin/questions/${materialId}/submit`).expect(200);
    await as(admin).post(`/admin/questions/${materialId}/publish`).expect(200);

    const paper = await as(admin)
      .post('/admin/papers', {
        subjectId,
        title: `模考卷 ${unique}`,
        type: 'MOCK',
        durationMin: 60,
        multiScoringRule: 'PARTIAL',
      })
      .expect(200);
    paperId = paper.body.data.id;
    await as(admin)
      .put(`/admin/papers/${paperId}/questions`, {
        sections: [
          { title: '单选', questionType: 'SINGLE' },
          { title: '多选', questionType: 'MULTIPLE' },
          { title: '简答', questionType: 'SHORT_ANSWER' },
          { title: '资料', questionType: 'MATERIAL' },
        ],
        questions: [
          ...singles.map((questionId) => ({ questionId, sectionIndex: 0, score: 2 })),
          { questionId: multiId, sectionIndex: 1, score: 4 },
          { questionId: shortId, sectionIndex: 2, score: 10 },
          { questionId: materialId, sectionIndex: 3, score: 1 },
        ],
      })
      .expect(200);
    await as(admin).post(`/admin/papers/${paperId}/publish`).expect(200);
  }, 180_000);

  afterAll(async () => {
    try {
      vi.restoreAllMocks();
      if (subjectId) {
        await dataSource.query(`DELETE FROM "practice_session" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "daily_question_set" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "paper" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "paper_rule" WHERE "subjectId" = $1`, [subjectId]);
        const owned = `SELECT "id" FROM "question" WHERE "subjectId" = $1`;
        await dataSource.query(`DELETE FROM "question_version" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(`DELETE FROM "question" WHERE "subjectId" = $1 AND "parentId" IS NOT NULL`, [subjectId]);
        await dataSource.query(`DELETE FROM "question" WHERE "subjectId" = $1`, [subjectId]);
        for (const level of [3, 2, 1]) {
          await dataSource.query(`DELETE FROM "knowledge_point" WHERE "subjectId" = $1 AND "level" = $2`, [
            subjectId,
            level,
          ]);
        }
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

  afterEach(() => {
    publishSpy.mockClear();
  });

  describe('a full mock exam', () => {
    let sessionId: string;
    let chapterId: string;
    let attemptsBefore: number;

    it('should require a paper of the subject', async () => {
      await as(user)
        .post('/practice/sessions', { mode: 'MOCK', subjectId, deviceId: 'a' })
        .expect(422)
        .expect(({ body }) => expect(body.data.errorKey).toBe('paperRequired'));
      await startMock(user, 'a', examId)
        .expect(422)
        .expect(({ body }) => expect(body.data.paperId).toBeDefined());
    });

    it('should start only one session for concurrent requests and resume it on re-entry', async () => {
      const chapter = await as(user)
        .post('/practice/sessions', {
          mode: 'CHAPTER',
          subjectId,
          scope: { knowledgePointId: leaf },
          count: 50,
          deviceId: 'a',
        })
        .expect(200);
      chapterId = chapter.body.data.id;
      attemptsBefore = await paperAttempts();

      const responses = await Promise.all([startMock(user, 'device-a'), startMock(user, 'device-a')]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const [first, second] = responses.map((response) => response.body.data);
      expect(second.id).toBe(first.id);
      sessionId = first.id;
      expect(first).toMatchObject({
        mode: 'MOCK',
        paperId,
        status: 'IN_PROGRESS',
        questionCount: 7,
        isActiveDevice: true,
        isFirstAttempt: false,
        scoringScheme: 'OBJECTIVE_ONLY',
        totalScore: 12,
      });
      const startedAt = Date.parse(first.startedAt);
      expect(Date.parse(first.deadlineAt) - startedAt).toBe(60 * MINUTE);
      expect(Date.parse(first.autoSubmitAt) - Date.parse(first.deadlineAt)).toBe(syncWindowMin * MINUTE);
      expect(first.serverNow).toBeDefined();
      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      expect(scheduleSpy).toHaveBeenCalledWith(sessionId, new Date(first.autoSubmitAt));

      const rows: { count: number }[] = await dataSource.query(
        `SELECT COUNT(*)::int AS "count" FROM "practice_session"
         WHERE "userId" = $1 AND "paperId" = $2 AND "status" = 'IN_PROGRESS'`,
        [user.id, paperId],
      );
      expect(rows[0].count).toBe(1);

      const resumed = await startMock(user, 'device-a').expect(200);
      expect(resumed.body.data.id).toBe(sessionId);
    });

    it('should hide answers of the ongoing mock everywhere', async () => {
      const { body } = await as(user).get(`/practice/sessions/${sessionId}/questions?from=0&size=50`).expect(200);
      expect(JSON.stringify(body.data)).not.toMatch(/"analysis"|参考答案/);
      expect(body.data.units[0]).toMatchObject({ hiddenReason: 'mockInProgress', solution: null });

      await as(user)
        .put(`/practice/sessions/${chapterId}/answers`, {
          deviceId: 'a',
          answers: [{ questionId: singles[0], answer: { keys: ['B'] }, clientSeq: 1, clientAnsweredAt: new Date() }],
        })
        .expect(409)
        .expect(({ body: rejected }) => expect(rejected.data.errorKey).toBe('questionInMockInProgress'));
      const question = await as(user).get(`/questions/${singles[0]}`).expect(200);
      expect(question.body.data.hiddenReason).toBe('mockInProgress');
      await as(user)
        .get(`/practice/sessions/${sessionId}/report`)
        .expect(409)
        .expect(({ body: rejected }) => expect(rejected.data.errorKey).toBe('reportNotAvailable'));
    });

    it('should mark the first attempt once for concurrent first answers', async () => {
      const responses = await Promise.all([
        save(user, sessionId, 'device-a', [{ questionId: singles[0], answer: { keys: ['B'] }, clientSeq: 1 }]),
        save(user, sessionId, 'device-a', [{ questionId: singles[1], answer: { keys: ['A'] }, clientSeq: 2 }]),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(responses[0].body.data.results[0].answerState).toMatchObject({ answer: { keys: ['B'] }, isCorrect: null });

      const current = await detail(user, sessionId);
      expect(current).toMatchObject({ isFirstAttempt: true, answeredCount: 2 });
      expect(await paperAttempts()).toBe(attemptsBefore + 1);
    });

    it('should let a new device take over and reject later writes of the previous device', async () => {
      const takeover = await startMock(user, 'device-b').expect(200);
      expect(takeover.body.data).toMatchObject({ id: sessionId, isActiveDevice: true });
      expect(
        (takeover.body.data.card as CardItem[])
          .filter((item) => item.answered)
          .map((item) => item.questionId)
          .sort(),
      ).toEqual([singles[0], singles[1]].sort());

      await detail(user, sessionId);
      await save(user, sessionId, 'device-a', [{ questionId: singles[2], answer: { keys: ['B'] }, clientSeq: 3 }])
        .expect(409)
        .expect(({ body }) => expect(body.data.errorKey).toBe('sessionTakenOver'));

      await save(user, sessionId, 'device-b', [
        { questionId: singles[1], answer: { keys: ['B'] }, clientSeq: 1 },
        { questionId: multiId, answer: { keys: ['A'] }, clientSeq: 2 },
        { questionId: shortId, answer: { text: '我的作答' }, clientSeq: 3 },
        { questionId: subIds[0], answer: { keys: ['B'] }, clientSeq: 4 },
        { questionId: subIds[1], answer: { keys: ['A'] }, clientSeq: 5 },
      ]).expect(200);
      expect(await paperAttempts()).toBe(attemptsBefore + 1);
    });

    it('should order writes by client sequence and keep soft cleared records', async () => {
      await save(user, sessionId, 'device-b', [{ questionId: singles[2], answer: { keys: ['A'] }, clientSeq: 10 }]);
      await save(user, sessionId, 'device-b', [{ questionId: singles[2], answer: null, clientSeq: 11 }]).expect(200);
      const stale = await save(user, sessionId, 'device-b', [
        { questionId: singles[2], answer: { keys: ['A'] }, clientSeq: 10 },
      ]).expect(200);
      expect(stale.body.data.results[0].answerState).toMatchObject({ answer: null, clientSeq: 11 });

      const rows: { answer: unknown; clientSeq: number }[] = await dataSource.query(
        `SELECT "answer", "clientSeq" FROM "answer_record" WHERE "sessionId" = $1 AND "questionId" = $2`,
        [sessionId, singles[2]],
      );
      expect(rows).toEqual([{ answer: null, clientSeq: 11 }]);
      expect(await detail(user, sessionId)).toMatchObject({ answeredCount: 6, isFirstAttempt: true });
    });

    it('should accept only offline answers made before the deadline during the sync window', async () => {
      const deadline = new Date(Date.now() - MINUTE);
      await setTimes(
        sessionId,
        deadline,
        new Date(Date.now() + 4 * MINUTE),
        new Date(deadline.getTime() - 60 * MINUTE),
      );

      await save(user, sessionId, 'device-b', [{ questionId: subIds[1], answer: { keys: ['B'] }, clientSeq: 20 }])
        .expect(409)
        .expect(({ body }) => expect(body.data.errorKey).toBe('sessionClosed'));

      const late = await startMock(user, 'device-c').expect(200);
      expect(late.body.data).toMatchObject({ id: sessionId, isActiveDevice: false });
      await save(user, sessionId, 'device-c', [{ questionId: subIds[1], answer: { keys: ['B'] }, clientSeq: 1 }], true)
        .expect(409)
        .expect(({ body }) => expect(body.data.errorKey).toBe('sessionTakenOver'));

      const synced = await save(
        user,
        sessionId,
        'device-b',
        [
          {
            questionId: subIds[1],
            answer: { keys: ['B'] },
            clientSeq: 21,
            clientAnsweredAt: new Date(deadline.getTime() - 1000).toISOString(),
          },
          {
            questionId: multiId,
            answer: { keys: ['A', 'C'] },
            clientSeq: 22,
            clientAnsweredAt: new Date(deadline.getTime() + 1000).toISOString(),
          },
        ],
        true,
      ).expect(200);
      expect(synced.body.data.skippedQuestionIds).toEqual([multiId]);
      const records: { questionId: string; answer: unknown }[] = await dataSource.query(
        `SELECT "questionId", "answer" FROM "answer_record" WHERE "sessionId" = $1 AND "questionId" = ANY($2::uuid[])`,
        [sessionId, [subIds[1], multiId]],
      );
      expect(Object.fromEntries(records.map((row) => [row.questionId, row.answer]))).toEqual({
        [subIds[1]]: { keys: ['B'] },
        [multiId]: { keys: ['A'] },
      });
    });

    it('should submit once for concurrent manual submissions and grade objective answers', async () => {
      const responses = await Promise.all([
        as(user).post(`/practice/sessions/${sessionId}/submit`),
        as(user).post(`/practice/sessions/${sessionId}/submit`),
      ]);
      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(responses[0].body.data).toMatchObject({
        status: 'SUBMITTED',
        submitType: 'MANUAL',
        score: 8,
        totalScore: 12,
        correctCount: 4,
        answeredCount: 6,
        durationSec: 60 * 60,
      });
      expect(responses[1].body.data).toMatchObject({ status: 'SUBMITTED', score: 8 });
      expect(publishSpy).toHaveBeenCalledTimes(1);
      expect(publishSpy).toHaveBeenCalledWith(sessionId);

      await save(
        user,
        sessionId,
        'device-b',
        [{ questionId: singles[2], answer: { keys: ['B'] }, clientSeq: 30 }],
        true,
      )
        .expect(409)
        .expect(({ body }) => expect(body.data.errorKey).toBe('sessionClosed'));
    });

    it('should reveal answers after submission', async () => {
      const { body } = await as(user).get(`/practice/sessions/${sessionId}/questions?from=0&size=50`).expect(200);
      expect(body.data.units[0]).toMatchObject({
        id: singles[0],
        hiddenReason: null,
        solution: { answer: { keys: ['B'] } },
        answerState: { isCorrect: true, score: 2 },
      });
      const accepted = await as(user)
        .put(`/practice/sessions/${chapterId}/answers`, {
          deviceId: 'a',
          answers: [{ questionId: singles[0], answer: { keys: ['B'] }, clientSeq: 1, clientAnsweredAt: new Date() }],
        })
        .expect(200);
      expect(accepted.body.data.results[0].answerState.isCorrect).toBe(true);
    });

    it('should not count an abandoned first attempt or the retake in the percentile sample', async () => {
      const retaker = await registerAndLogin(app);
      const abandoned = await answerAll(retaker, 'r', { [singles[0]]: { keys: ['B'] } });
      await as(retaker).post(`/practice/sessions/${abandoned}/abandon`).expect(200);
      const retake = await answerAll(retaker, 'r', {
        [singles[0]]: { keys: ['B'] },
        [singles[1]]: { keys: ['B'] },
        [singles[2]]: { keys: ['B'] },
      });
      expect(retake).not.toBe(abandoned);
      const submitted = await as(retaker).post(`/practice/sessions/${retake}/submit`).expect(200);
      expect(submitted.body.data).toMatchObject({ isFirstAttempt: false, score: 6 });
      expect((await detail(retaker, abandoned)).isFirstAttempt).toBe(true);

      const graded: { count: number }[] = await dataSource.query(
        `SELECT COUNT(*)::int AS "count" FROM "answer_record" WHERE "sessionId" = $1 AND "isCorrect" IS NOT NULL`,
        [abandoned],
      );
      expect(graded[0].count).toBe(0);

      for (const answers of [
        { [singles[0]]: { keys: ['B'] } },
        {
          [multiId]: { keys: ['A', 'C'] },
          [singles[0]]: { keys: ['B'] },
          [singles[1]]: { keys: ['B'] },
          [singles[2]]: { keys: ['B'] },
        },
      ]) {
        const peer = await registerAndLogin(app);
        const id = await answerAll(peer, 'p', answers);
        await as(peer).post(`/practice/sessions/${id}/submit`).expect(200);
      }
      expect(await paperAttempts()).toBe(attemptsBefore + 4);
    });

    it('should report score, percentile, accuracy and the answer card', async () => {
      const { body } = await as(user).get(`/practice/sessions/${sessionId}/report`).expect(200);
      const report = body.data;
      expect(report).toMatchObject({
        score: 8,
        totalScore: 12,
        questionCount: 7,
        answeredCount: 6,
        correctCount: 4,
        accuracy: 0.5714,
        durationSec: 60 * 60,
        percentile: { beatRatio: 0.5, sampleSize: 2 },
        selfAssessment: { pendingQuestionIds: [shortId] },
        wrongQuestionCount: 1,
      });
      const statuses = Object.fromEntries(
        (report.card as ReportCard[]).map((item) => [item.questionId, [item.status, item.score]]),
      );
      expect(statuses).toEqual({
        [singles[0]]: ['CORRECT', 2],
        [singles[1]]: ['CORRECT', 2],
        [singles[2]]: ['UNANSWERED', null],
        [multiId]: ['PARTIAL', 2],
        [shortId]: ['PENDING_SELF_ASSESSMENT', null],
        [subIds[0]]: ['CORRECT', 1],
        [subIds[1]]: ['CORRECT', 1],
      });
      expect(report.byType).toEqual(
        expect.arrayContaining([expect.objectContaining({ type: 'SINGLE', total: 5, answered: 4, correct: 4 })]),
      );
      expect(report.byKnowledgePoint).toEqual([
        expect.objectContaining({ knowledgePointId: leaf, name: '法律', total: 7, correct: 4 }),
      ]);

      await as(user)
        .post(`/practice/sessions/${sessionId}/self-assessment`, { questionId: shortId, selfAssessment: 'KNOWN' })
        .expect(200);
      const assessed = await as(user).get(`/practice/sessions/${sessionId}/report`).expect(200);
      expect(assessed.body.data).toMatchObject({ correctCount: 5, selfAssessment: { pendingQuestionIds: [] } });
      expect((assessed.body.data.card as ReportCard[]).find((item) => item.questionId === shortId)?.status).toBe(
        'CORRECT',
      );
    });

    it('should show the latest and best scores in the paper list', async () => {
      const signedIn = await as(user).get(`/subjects/${subjectId}/papers`).expect(200);
      expect(signedIn.body.data.list.find((item: { id: string }) => item.id === paperId)).toMatchObject({
        lastScore: 8,
        bestScore: 8,
        attemptCount: attemptsBefore + 4,
      });
      const anonymous = await as(null).get(`/subjects/${subjectId}/papers`).expect(200);
      expect(anonymous.body.data.list.find((item: { id: string }) => item.id === paperId)).toMatchObject({
        lastScore: null,
        bestScore: null,
      });
    });
  });

  describe('automatic submission', () => {
    it('should enqueue a delayed job at the auto submit time and delay it again when triggered early', async () => {
      const account = await registerAndLogin(app);
      scheduleSpy.mockRestore();
      try {
        const { body } = await startMock(account, 'q').expect(200);
        const queue = app.get<Queue>(getQueueToken(MOCK_SUBMIT_QUEUE));
        const job = await queue.getJob(body.data.id);
        expect(job?.data).toEqual({ sessionId: body.data.id });
        expect(await job?.isDelayed()).toBe(true);
        const expectedDelay = Date.parse(body.data.autoSubmitAt) - Date.now();
        expect(Math.abs((job?.opts.delay ?? 0) - expectedDelay)).toBeLessThan(10_000);
        await job?.remove();

        await queue.add(MOCK_SUBMIT_JOB_NAME, { sessionId: body.data.id }, { jobId: body.data.id });
        let state = await queue.getJobState(body.data.id);
        for (let poll = 0; poll < 100 && state !== 'delayed'; poll += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          state = await queue.getJobState(body.data.id);
        }
        expect(state).toBe('delayed');
        expect(await detail(account, body.data.id)).toMatchObject({ status: 'IN_PROGRESS' });
        await (await queue.getJob(body.data.id))?.remove();
      } finally {
        scheduleSpy = vi.spyOn(app.get(MockSubmitScheduler), 'schedule').mockResolvedValue(undefined);
      }
    });

    it('should submit an overdue session on re-entry, return it and start a new one on the next entry', async () => {
      const returning = await registerAndLogin(app);
      const id = await answerAll(returning, 'e', { [singles[0]]: { keys: ['B'] } });
      await setTimes(id, new Date(Date.now() - 6 * MINUTE), new Date(Date.now() - MINUTE));

      const reentry = await startMock(returning, 'e').expect(200);
      expect(reentry.body.data).toMatchObject({
        id,
        status: 'SUBMITTED',
        submitType: 'AUTO_TIMEOUT',
        score: 2,
        isActiveDevice: false,
      });
      await as(returning).get(`/practice/sessions/${id}/report`).expect(200);

      const next = await startMock(returning, 'e').expect(200);
      expect(next.body.data).toMatchObject({ status: 'IN_PROGRESS', isActiveDevice: true });
      expect(next.body.data.id).not.toBe(id);
    });

    it('should apply only one of concurrent manual and automatic submissions after the window', async () => {
      const racer = await registerAndLogin(app);
      const id = await answerAll(racer, 'x', { [singles[0]]: { keys: ['B'] } });
      await setTimes(id, new Date(Date.now() - 6 * MINUTE), new Date(Date.now() - MINUTE));

      const mockExamService = app.get(MockExamService);
      const [manual] = await Promise.all([
        as(racer).post(`/practice/sessions/${id}/submit`),
        mockExamService.autoSubmit(id),
        mockExamService.autoSubmit(id),
      ]);

      expect(manual.status).toBe(200);
      expect(manual.body.data).toMatchObject({ status: 'SUBMITTED', submitType: 'AUTO_TIMEOUT', score: 2 });
      expect(publishSpy.mock.calls.filter(([sessionId]) => sessionId === id)).toHaveLength(1);
    });

    it('should submit overdue sessions in the scan and abandon those without answers', async () => {
      const idle = await registerAndLogin(app);
      const late = await registerAndLogin(app);
      const idleId = await answerAll(idle, 'i', {});
      const lateId = await answerAll(late, 'l', { [singles[0]]: { keys: ['A'] } });
      for (const id of [idleId, lateId]) {
        await setTimes(
          id,
          new Date('1999-12-31T23:55:00Z'),
          new Date('2000-01-01T00:00:00Z'),
          new Date('1999-12-31T23:00:00Z'),
        );
      }

      await app.get(AutoSubmitMockSessionsTask).submitDue(new Date('2000-01-02T00:00:00Z'));

      expect(await detail(idle, idleId)).toMatchObject({ status: 'ABANDONED', score: null });
      expect(await detail(late, lateId)).toMatchObject({
        status: 'SUBMITTED',
        submitType: 'AUTO_TIMEOUT',
        score: 0,
        durationSec: 55 * 60,
      });
      await save(late, lateId, 'l', [{ questionId: singles[1], answer: { keys: ['B'] }, clientSeq: 9 }], true)
        .expect(409)
        .expect(({ body }) => expect(body.data.errorKey).toBe('sessionClosed'));
    });
  });

  describe('generated papers', () => {
    let owner: Account;
    let ruleId: string;
    let generatedId: string;

    beforeAll(async () => {
      owner = await registerAndLogin(app);
      const rule = await as(admin)
        .post('/admin/paper-rules', {
          subjectId,
          name: `个人组卷 ${unique}`,
          durationMin: 30,
          items: [{ sectionTitle: '单选', questionType: 'SINGLE', count: 1, scorePerQuestion: 3 }],
        })
        .expect(200);
      ruleId = rule.body.data.id;
    });

    it('should list and generate from published rules only', async () => {
      await as(null).get(`/subjects/${subjectId}/paper-rules`).expect(401);
      const draft = await as(owner).get(`/subjects/${subjectId}/paper-rules`).expect(200);
      expect(draft.body.data).toEqual([]);
      await as(owner).post(`/paper-rules/${ruleId}/generate`).expect(404);
      await as(null).post(`/paper-rules/${ruleId}/generate`).expect(401);

      await as(admin).patch(`/admin/paper-rules/${ruleId}`, { status: 'PUBLISHED' }).expect(200);
      const published = await as(owner).get(`/subjects/${subjectId}/paper-rules`).expect(200);
      expect(published.body.data).toEqual([
        { id: ruleId, name: `个人组卷 ${unique}`, durationMin: 30, questionCount: 1, totalScore: 3 },
      ]);
    });

    it('should generate a paper visible only to the owner excluding recently answered questions', async () => {
      const recent = await answerAll(owner, 'o', { [singles[0]]: { keys: ['B'] }, [singles[1]]: { keys: ['B'] } });
      await as(owner).post(`/practice/sessions/${recent}/submit`).expect(200);

      const { body } = await as(owner).post(`/paper-rules/${ruleId}/generate`).expect(200);
      generatedId = body.data.paperId;
      expect(body.data).toMatchObject({ questionCount: 1, insufficient: false });
      const paper = await as(owner).get(`/papers/${generatedId}`).expect(200);
      expect(paper.body.data).toMatchObject({ type: 'GENERATED', durationMin: 30, totalScore: 3, questionCount: 1 });
      const rows: { questionId: string; questionVersion: number }[] = await dataSource.query(
        `SELECT "questionId", "questionVersion" FROM "paper_question" WHERE "paperId" = $1`,
        [generatedId],
      );
      expect(rows.map((row) => row.questionId)).toEqual([singles[2]]);

      await as(user).get(`/papers/${generatedId}`).expect(404);
      await startMock(user, 'u', generatedId).expect(422);
      const others = await as(user).get(`/subjects/${subjectId}/papers?type=GENERATED`).expect(200);
      expect(others.body.data.list).toEqual([]);
    });

    it('should take the generated paper as a mock exam without a percentile', async () => {
      const { body } = await startMock(owner, 'o', generatedId).expect(200);
      await save(owner, body.data.id, 'o', [{ questionId: singles[2], answer: { keys: ['B'] }, clientSeq: 1 }]).expect(
        200,
      );
      await as(owner).post(`/practice/sessions/${body.data.id}/submit`).expect(200);
      const report = await as(owner).get(`/practice/sessions/${body.data.id}/report`).expect(200);
      expect(report.body.data).toMatchObject({ score: 3, totalScore: 3, percentile: null });
      const list = await as(owner).get(`/subjects/${subjectId}/papers?type=GENERATED`).expect(200);
      expect(list.body.data.list).toEqual([expect.objectContaining({ id: generatedId, lastScore: 3, bestScore: 3 })]);
    });

    it('should limit daily generations per user', async () => {
      const configured = await app.get(AppConfigService).getValue<number>('paper.generateDailyLimit');
      const limit = typeof configured === 'number' ? configured : 5;
      for (let index = 1; index < limit; index += 1) {
        await as(owner).post(`/paper-rules/${ruleId}/generate`).expect(200);
      }
      await as(owner)
        .post(`/paper-rules/${ruleId}/generate`)
        .expect(429)
        .expect(({ body }) => expect(body.data.errorKey).toBe('generateLimitExceeded'));
      const rows: { count: number }[] = await dataSource.query(
        `SELECT COUNT(*)::int AS "count" FROM "paper" WHERE "ownerUserId" = $1 AND "type" = 'GENERATED'`,
        [owner.id],
      );
      expect(rows[0].count).toBe(limit);
    });

    it('should remove generated papers never started after seven days', async () => {
      const papers: { id: string }[] = await dataSource.query(
        `SELECT "id" FROM "paper" WHERE "ownerUserId" = $1 AND "type" = 'GENERATED' AND "id" <> $2 LIMIT 1`,
        [owner.id, generatedId],
      );
      const stale = papers[0].id;
      await dataSource.query(`UPDATE "paper" SET "createdAt" = '2000-01-01' WHERE "id" = ANY($1::uuid[])`, [
        [stale, generatedId],
      ]);

      const removed = await app.get(PaperRepository).removeStaleGenerated(new Date('2000-01-02T12:00:00Z'), 500);

      expect(removed).toBe(1);
      const left: { id: string }[] = await dataSource.query(`SELECT "id" FROM "paper" WHERE "id" = ANY($1::uuid[])`, [
        [stale, generatedId],
      ]);
      expect(left.map((row) => row.id)).toEqual([generatedId]);
    });
  });

  it('should report the daily practice completion of the signed-in user', async () => {
    const learner = await registerAndLogin(app);
    await dataSource.query(
      `INSERT INTO "daily_question_set" ("subjectId", "date", "questionIds") VALUES ($1, $2, $3)
       ON CONFLICT ("subjectId", "date") DO UPDATE SET "questionIds" = EXCLUDED."questionIds"`,
      [subjectId, businessDate(), [singles[0], singles[1]]],
    );
    const before = await as(learner).get(`/subjects/${subjectId}/daily`).expect(200);
    expect(before.body.data.completion).toEqual({
      sessionId: null,
      questionCount: 2,
      answeredCount: 0,
      correctCount: 0,
      completed: false,
    });

    const daily = await as(learner).post('/practice/sessions', { mode: 'DAILY', subjectId, deviceId: 'd' }).expect(200);
    await as(learner)
      .put(`/practice/sessions/${daily.body.data.id}/answers`, {
        deviceId: 'd',
        answers: [singles[0], singles[1]].map((questionId, index) => ({
          questionId,
          answer: { keys: ['B'] },
          clientSeq: index + 1,
          clientAnsweredAt: new Date(),
        })),
      })
      .expect(200);

    const after = await as(learner).get(`/subjects/${subjectId}/daily`).expect(200);
    expect(after.body.data.completion).toEqual({
      sessionId: daily.body.data.id,
      questionCount: 2,
      answeredCount: 2,
      correctCount: 2,
      completed: true,
    });
    const anonymous = await as(null).get(`/subjects/${subjectId}/daily`).expect(200);
    expect(anonymous.body.data.completion).toBeNull();
  });
});
