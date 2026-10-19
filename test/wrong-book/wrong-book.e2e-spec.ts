// 需在独立的测试数据库与 Redis 上运行：会注册测试用户并写入考试、科目、知识点、题目、练习会话与错题
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { md5 } from '../utils/constants';
import { createTestApp, randomIp } from '../utils/test-app';
import { deletePracticeSessions } from '../utils/practice-sessions';
import { UsersService } from '../../src/core/users/users.service';
import { PermissionsService } from '../../src/core/permissions/permissions.service';
import { RoleEnum } from '../../src/common/enums/roles/roles.enum';
import { StatsEventQueue } from '../../src/modules/study-stats/stats-event.queue';
import { StatsEventService } from '../../src/modules/study-stats/stats-event.service';
import { AnswerVisibilityService } from '../../src/modules/practice/answer-visibility.service';
import { QuestionType } from '../../src/modules/questions/domain/question-type';

process.env.THROTTLE_ENABLED = 'true';
process.env.THROTTLE_LIMIT = '1000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

type Account = { token: string; email: string; id: number };
type WrongRow = {
  wrongCount: number;
  consecutiveCorrect: number;
  lastCorrectDate: string | null;
  status: string;
  masteredAt: Date | null;
  firstWrongAt: Date;
  lastWrongAnswer: Record<string, unknown> | null;
};
type WrongItem = WrongRow & {
  questionId: string;
  isOffline: boolean;
  hiddenReason: string | null;
  question: Record<string, unknown> | null;
};
type PracticeQuestion = { id: string; hiddenReason: string | null; solution: unknown; children?: PracticeQuestion[] };

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

async function registerAndLogin(app: NestExpressApplication): Promise<Account> {
  const email = `wrong.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = md5('Secret00');
  await api(app)
    .post('/api/v1/auth/email/register')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password, firstName: 'Wrong', lastName: 'E2E' })
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

describe('Wrong book', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let admin: Account;
  let examId: string;
  let subjectId: string;
  let parentPointId: string;
  let leafPointId: string;
  const singles: string[] = [];
  let multipleId: string;
  let shortId: string;
  const unique = `${Date.now()}`;
  let seq = 0;

  const as = (account: Account) => {
    const withAuth = (req: request.Test): request.Test =>
      req.set('X-Forwarded-For', randomIp()).set('Authorization', `Bearer ${account.token}`);
    return {
      get: (path: string) => withAuth(api(app).get(`/api/v1${path}`)),
      post: (path: string, body?: object) => withAuth(api(app).post(`/api/v1${path}`)).send(body ?? {}),
      put: (path: string, body?: object) => withAuth(api(app).put(`/api/v1${path}`)).send(body ?? {}),
    };
  };

  const createQuestion = async (body: object): Promise<string> => {
    const { body: created } = await as(admin)
      .post('/admin/questions', { subjectId, ...body })
      .expect(200);
    await as(admin).post(`/admin/questions/${created.data.id}/submit`).expect(200);
    await as(admin).post(`/admin/questions/${created.data.id}/publish`).expect(200);
    return created.data.id as string;
  };

  const startSession = async (account: Account, mode = 'RANDOM'): Promise<{ id: string; questionIds: string[] }> => {
    const { body } = await as(account)
      .post('/practice/sessions', { subjectId, mode, count: 20, deviceId: 'device-1' })
      .expect(200);
    return {
      id: body.data.id as string,
      questionIds: (body.data.card as { questionId: string }[]).map((item) => item.questionId),
    };
  };

  const answer = (account: Account, sessionId: string, questionId: string, value: object) =>
    as(account)
      .put(`/practice/sessions/${sessionId}/answers`, {
        deviceId: 'device-1',
        answers: [{ questionId, answer: value, clientSeq: (seq += 1), clientAnsweredAt: new Date().toISOString() }],
      })
      .expect(200);

  const recordId = async (sessionId: string, questionId: string): Promise<string> =>
    (
      await dataSource.query(`SELECT "id" FROM "answer_record" WHERE "sessionId" = $1 AND "questionId" = $2`, [
        sessionId,
        questionId,
      ])
    )[0].id;

  /** 新开会话作答并以指定统计日直接计入 */
  const answerAndApply = async (
    account: Account,
    questionId: string,
    value: object,
    statDate?: string,
  ): Promise<string> => {
    const session = await startSession(account);
    await answer(account, session.id, questionId, value);
    const id = await recordId(session.id, questionId);
    if (statDate) {
      await dataSource.query(`UPDATE "answer_record" SET "statDate" = $2 WHERE "id" = $1`, [id, statDate]);
    }
    await expect(app.get(StatsEventService).applyRecord(id)).resolves.toBe(true);
    return session.id;
  };

  const wrongRow = async (account: Account, questionId: string): Promise<WrongRow | undefined> =>
    (
      await dataSource.query(
        `SELECT "wrongCount", "consecutiveCorrect", "lastCorrectDate"::text AS "lastCorrectDate", "status",
                "masteredAt", "firstWrongAt", "lastWrongAnswer"
         FROM "wrong_question" WHERE "userId" = $1 AND "questionId" = $2`,
        [account.id, questionId],
      )
    )[0];

  const listWrongBook = async (account: Account, query = ''): Promise<WrongItem[]> => {
    const { body } = await as(account).get(`/wrong-book${query}`).expect(200);
    return body.data.list as WrongItem[];
  };

  const withoutPublishing = () => vi.spyOn(app.get(StatsEventQueue), 'publishRecord').mockResolvedValue(undefined);

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await app.get(PermissionsService).refreshCache();
    admin = await registerAndLogin(app);
    await setRole(app, admin.email, RoleEnum.admin);

    const exam = await as(admin)
      .post('/admin/exams', { name: 'E2E 错题本考试', category: 'CIVIL_SERVICE' })
      .expect(200);
    examId = exam.body.data.id;
    await as(admin).post(`/admin/exams/${examId}/publish`).expect(200);
    const subject = await as(admin).post('/admin/subjects', { examId, name: '行测' }).expect(200);
    subjectId = subject.body.data.id;
    await as(admin).post(`/admin/subjects/${subjectId}/publish`).expect(200);
    const parent = await as(admin)
      .post('/admin/knowledge-points', { subjectId, parentId: null, name: '常识' })
      .expect(200);
    parentPointId = parent.body.data.id;
    const leaf = await as(admin)
      .post('/admin/knowledge-points', { subjectId, parentId: parentPointId, name: '法律' })
      .expect(200);
    leafPointId = leaf.body.data.id;
    for (const name of ['甲', '乙', '丙', '丁', '戊']) {
      singles.push(
        await createQuestion({
          type: 'SINGLE',
          stem: `错题${name} ${unique}`,
          options: ['A', 'B', 'C'].map((key) => ({ key, content: key })),
          answer: { keys: ['B'] },
          analysis: `错题${name}解析`,
          knowledgePointIds: [leafPointId],
        }),
      );
    }
    multipleId = await createQuestion({
      type: 'MULTIPLE',
      stem: `多选 ${unique}`,
      options: ['A', 'B', 'C', 'D'].map((key) => ({ key, content: key })),
      answer: { keys: ['A', 'B'] },
      knowledgePointIds: [leafPointId],
    });
    shortId = await createQuestion({
      type: 'SHORT_ANSWER',
      stem: `简答 ${unique}`,
      answer: { reference: '参考答案', points: ['要点一'] },
      knowledgePointIds: [leafPointId],
    });
  }, 120_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      if (subjectId) {
        await deletePracticeSessions(app, [subjectId]);
        const owned = `SELECT "id" FROM "question" WHERE "subjectId" = $1`;
        await dataSource.query(`DELETE FROM "wrong_question" WHERE "questionId" IN (${owned})`, [subjectId]);
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

  it('should add a wrong practice answer through the stats queue and list it without the answer', async () => {
    const user = await registerAndLogin(app);
    const session = await startSession(user);
    await answer(user, session.id, singles[0], { keys: ['A'] });

    const row = await waitFor(() => wrongRow(user, singles[0]));
    expect(row).toMatchObject({
      wrongCount: 1,
      consecutiveCorrect: 0,
      status: 'ACTIVE',
      lastWrongAnswer: { keys: ['A'] },
    });

    const [item, ...rest] = await listWrongBook(user);
    expect(rest).toEqual([]);
    expect(item).toMatchObject({
      questionId: singles[0],
      subjectId,
      wrongCount: 1,
      status: 'ACTIVE',
      isOffline: false,
      hiddenReason: null,
      question: { id: singles[0], stem: `错题甲 ${unique}`, type: 'SINGLE' },
    });
    expect(JSON.stringify(item.question)).not.toMatch(/"answer"|analysis|解析/);

    const { body } = await as(user).get('/wrong-book/summary').expect(200);
    expect(body.data).toMatchObject({
      activeCount: 1,
      weeklyAdded: 1,
      weeklyMastered: 0,
      bySubject: [{ subjectId, activeCount: 1 }],
    });
    expect(body.data.byKnowledgePoint).toEqual(
      expect.arrayContaining([
        { knowledgePointId: parentPointId, activeCount: 1 },
        { knowledgePointId: leafPointId, activeCount: 1 },
      ]),
    );
  });

  it('should count correct answers once per stat day, skip earlier days and master after three stat days', async () => {
    const user = await registerAndLogin(app);
    withoutPublishing();
    const questionId = singles[1];
    await answerAndApply(user, questionId, { keys: ['C'] });
    expect(await wrongRow(user, questionId)).toMatchObject({ wrongCount: 1, consecutiveCorrect: 0 });

    await answerAndApply(user, questionId, { keys: ['B'] }, '2026-09-02');
    await answerAndApply(user, questionId, { keys: ['B'] }, '2026-09-02');
    expect(await wrongRow(user, questionId)).toMatchObject({ consecutiveCorrect: 1, lastCorrectDate: '2026-09-02' });

    await answerAndApply(user, questionId, { keys: ['B'] }, '2026-09-01');
    expect(await wrongRow(user, questionId)).toMatchObject({ consecutiveCorrect: 1, lastCorrectDate: '2026-09-02' });

    await answerAndApply(user, questionId, { keys: ['B'] }, '2026-09-03');
    expect(await wrongRow(user, questionId)).toMatchObject({ consecutiveCorrect: 2, status: 'ACTIVE' });

    await answerAndApply(user, questionId, { keys: ['B'] }, '2026-09-04');
    const mastered = await wrongRow(user, questionId);
    expect(mastered).toMatchObject({ consecutiveCorrect: 3, status: 'MASTERED', lastCorrectDate: '2026-09-04' });
    expect(mastered?.masteredAt).not.toBeNull();

    expect(await listWrongBook(user)).toEqual([]);
    expect((await listWrongBook(user, '?status=MASTERED')).map((item) => item.questionId)).toEqual([questionId]);
    const { body } = await as(user).get(`/wrong-book/summary?subjectId=${subjectId}`).expect(200);
    expect(body.data).toMatchObject({ activeCount: 0, weeklyAdded: 1, weeklyMastered: 1 });

    await answerAndApply(user, questionId, { keys: ['A'] });
    expect(await wrongRow(user, questionId)).toMatchObject({
      wrongCount: 2,
      consecutiveCorrect: 0,
      status: 'ACTIVE',
      masteredAt: null,
      lastWrongAnswer: { keys: ['A'] },
    });
  });

  it('should not count a correct answer on a stat day already counted before a wrong answer', async () => {
    const user = await registerAndLogin(app);
    withoutPublishing();
    const questionId = singles[1];
    await answerAndApply(user, questionId, { keys: ['A'] });
    await answerAndApply(user, questionId, { keys: ['B'] }, '2026-09-10');
    await answerAndApply(user, questionId, { keys: ['C'] }, '2026-09-10');
    expect(await wrongRow(user, questionId)).toMatchObject({ wrongCount: 2, consecutiveCorrect: 0 });

    await answerAndApply(user, questionId, { keys: ['B'] }, '2026-09-10');
    expect(await wrongRow(user, questionId)).toMatchObject({ consecutiveCorrect: 0, lastCorrectDate: '2026-09-10' });

    await answerAndApply(user, questionId, { keys: ['B'] }, '2026-09-11');
    expect(await wrongRow(user, questionId)).toMatchObject({ consecutiveCorrect: 1, lastCorrectDate: '2026-09-11' });
  });

  it('should add partially correct answers and subjective answers self-assessed as unknown', async () => {
    const user = await registerAndLogin(app);
    withoutPublishing();

    const partialSession = await startSession(user);
    await answer(user, partialSession.id, multipleId, { keys: ['A'] });
    const partialId = await recordId(partialSession.id, multipleId);
    await dataSource.query(`UPDATE "answer_record" SET "isPartial" = true WHERE "id" = $1`, [partialId]);
    await app.get(StatsEventService).applyRecord(partialId);
    expect(await wrongRow(user, multipleId)).toMatchObject({ wrongCount: 1, status: 'ACTIVE' });

    const shortSession = await startSession(user);
    await answer(user, shortSession.id, shortId, { text: '不会' });
    await as(user)
      .post(`/practice/sessions/${shortSession.id}/self-assessment`, { questionId: shortId, selfAssessment: 'UNKNOWN' })
      .expect(200);
    await app.get(StatsEventService).applyRecord(await recordId(shortSession.id, shortId));
    expect(await wrongRow(user, shortId)).toMatchObject({ wrongCount: 1, status: 'ACTIVE' });
  });

  it('should not count subjective answers self-assessed as known toward mastering', async () => {
    const user = await registerAndLogin(app);
    withoutPublishing();
    const selfAssess = async (selfAssessment: string, statDate: string): Promise<void> => {
      const session = await startSession(user);
      await answer(user, session.id, shortId, { text: '作答' });
      await as(user)
        .post(`/practice/sessions/${session.id}/self-assessment`, { questionId: shortId, selfAssessment })
        .expect(200);
      const id = await recordId(session.id, shortId);
      await dataSource.query(`UPDATE "answer_record" SET "statDate" = $2 WHERE "id" = $1`, [id, statDate]);
      await app.get(StatsEventService).applyRecord(id);
    };

    await selfAssess('UNKNOWN', '2026-09-01');
    for (const statDate of ['2026-09-02', '2026-09-03', '2026-09-04']) {
      await selfAssess('KNOWN', statDate);
    }
    expect(await wrongRow(user, shortId)).toMatchObject({
      wrongCount: 1,
      consecutiveCorrect: 0,
      lastCorrectDate: null,
      status: 'ACTIVE',
    });
  });

  it('should master and restore wrong questions manually', async () => {
    const user = await registerAndLogin(app);
    withoutPublishing();
    const questionId = singles[2];
    await answerAndApply(user, questionId, { keys: ['A'] });
    await answerAndApply(user, questionId, { keys: ['B'] }, '2026-09-05');
    expect(await wrongRow(user, questionId)).toMatchObject({ consecutiveCorrect: 1 });

    const unchanged = await as(user).post(`/wrong-book/${questionId}/restore`).expect(200);
    expect(unchanged.body.data).toMatchObject({ questionId, status: 'ACTIVE', consecutiveCorrect: 1 });

    const mastered = await as(user).post(`/wrong-book/${questionId}/master`).expect(200);
    expect(mastered.body.data).toMatchObject({ questionId, status: 'MASTERED', consecutiveCorrect: 1 });
    expect(mastered.body.data.masteredAt).not.toBeNull();

    const restored = await as(user).post(`/wrong-book/${questionId}/restore`).expect(200);
    expect(restored.body.data).toMatchObject({ questionId, status: 'ACTIVE', consecutiveCorrect: 0, masteredAt: null });
    expect((await listWrongBook(user)).map((item) => item.questionId)).toEqual([questionId]);

    const other = await registerAndLogin(app);
    await as(other).post(`/wrong-book/${questionId}/master`).expect(404);
    await as(other).post(`/wrong-book/${questionId}/restore`).expect(404);
    await as(user).post('/wrong-book/not-a-uuid/master').expect(400);
  });

  it('should filter by knowledge point subtree and wrong count and sort by wrong count', async () => {
    const user = await registerAndLogin(app);
    withoutPublishing();
    await answerAndApply(user, singles[0], { keys: ['A'] });
    await answerAndApply(user, singles[2], { keys: ['A'] });
    await answerAndApply(user, singles[2], { keys: ['C'] });

    const byParent = await listWrongBook(user, `?knowledgePointId=${parentPointId}&sortBy=wrongCount&order=DESC`);
    expect(byParent.map((item) => [item.questionId, item.wrongCount])).toEqual([
      [singles[2], 2],
      [singles[0], 1],
    ]);
    expect((await listWrongBook(user, '?minWrongCount=2')).map((item) => item.questionId)).toEqual([singles[2]]);
    expect(
      await listWrongBook(user, `?lastWrongFrom=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}`),
    ).toEqual([]);
    await as(user).get('/wrong-book?sortBy=unknown').expect(422);
  });

  it('should reveal wrong book answers only outside sessions and hide them during an ongoing mock', async () => {
    const user = await registerAndLogin(app);
    withoutPublishing();
    const questionId = singles[3];
    await answerAndApply(user, questionId, { keys: ['A'] });

    const fresh = await startSession(user);
    expect(fresh.questionIds).toContain(questionId);
    const segment = async (id: string): Promise<PracticeQuestion | undefined> => {
      const { body } = await as(user).get(`/practice/sessions/${fresh.id}/questions?from=0&size=50`).expect(200);
      return (body.data.units as PracticeQuestion[])
        .flatMap((unit) => unit.children ?? [unit])
        .find((q) => q.id === id);
    };
    expect(await segment(questionId)).toMatchObject({ hiddenReason: null, solution: null });
    const standalone = () =>
      app.get(AnswerVisibilityService).evaluate(
        user.id,
        [questionId, singles[4]].map((id) => ({ questionId: id, questionType: QuestionType.SINGLE })),
        'standalone',
      );
    expect(await standalone()).toEqual([
      { visible: true, hiddenReason: null },
      { visible: false, hiddenReason: null },
    ]);

    await dataSource.query(
      `INSERT INTO "practice_session" ("userId", "subjectId", "mode", "questionIds", "questionVersions", "status")
       VALUES ($1, $2, 'MOCK', $3, $4, 'IN_PROGRESS')`,
      [user.id, subjectId, [questionId], { [questionId]: 1 }],
    );
    expect(await segment(questionId)).toMatchObject({ hiddenReason: 'mockInProgress', solution: null });
    expect((await standalone())[0]).toEqual({ visible: false, hiddenReason: 'mockInProgress' });
    const [item] = await listWrongBook(user);
    expect(item).toMatchObject({
      questionId,
      hiddenReason: 'mockInProgress',
      lastWrongAnswer: null,
      consecutiveCorrect: null,
      lastCorrectDate: null,
    });
  });

  it('should keep offline questions in the wrong book and exclude them from wrong question practice', async () => {
    const user = await registerAndLogin(app);
    withoutPublishing();
    const offlineId = await createQuestion({
      type: 'SINGLE',
      stem: `下架 ${unique}`,
      options: ['A', 'B'].map((key) => ({ key, content: key })),
      answer: { keys: ['B'] },
      knowledgePointIds: [leafPointId],
    });
    await answerAndApply(user, offlineId, { keys: ['A'] });
    await answerAndApply(user, singles[4], { keys: ['A'] });
    await as(admin).post(`/admin/questions/${offlineId}/offline`).expect(200);

    const { body: material } = await as(admin)
      .post('/admin/questions', { subjectId, type: 'MATERIAL', stem: `资料 ${unique}`, material: `材料正文 ${unique}` })
      .expect(200);
    const { body: child } = await as(admin)
      .post('/admin/questions', {
        subjectId,
        parentId: material.data.id,
        type: 'SINGLE',
        stem: `小题 ${unique}`,
        options: ['A', 'B'].map((key) => ({ key, content: key })),
        answer: { keys: ['B'] },
        knowledgePointIds: [leafPointId],
        sort: 0,
      })
      .expect(200);
    await as(admin).post(`/admin/questions/${material.data.id}/submit`).expect(200);
    await as(admin).post(`/admin/questions/${material.data.id}/publish`).expect(200);
    const childId = child.data.id as string;
    await answerAndApply(user, childId, { keys: ['A'] });
    await dataSource.query(`UPDATE "question" SET "status" = 'OFFLINE' WHERE "id" = $1`, [material.data.id]);
    expect((await dataSource.query(`SELECT "status" FROM "question" WHERE "id" = $1`, [childId]))[0].status).toBe(
      'PUBLISHED',
    );

    const wrongSession = await startSession(user, 'WRONG');
    expect(wrongSession.questionIds).toEqual([singles[4]]);

    const items = await listWrongBook(user);
    expect(items.find((item) => item.questionId === offlineId)).toMatchObject({ isOffline: true });
    expect(items.find((item) => item.questionId === singles[4])).toMatchObject({ isOffline: false });
    expect(items.find((item) => item.questionId === childId)).toMatchObject({ isOffline: true });
  });
});
