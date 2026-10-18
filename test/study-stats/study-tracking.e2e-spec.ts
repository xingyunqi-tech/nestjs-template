// 需在独立的测试数据库与 Redis 上运行：会注册测试用户并写入考试、科目、知识点、题目、练习会话与学习统计
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { md5 } from '../utils/constants';
import { createTestApp, randomIp } from '../utils/test-app';
import { UsersService } from '../../src/core/users/users.service';
import { PermissionsService } from '../../src/core/permissions/permissions.service';
import { RoleEnum } from '../../src/common/enums/roles/roles.enum';
import { StatsEventQueue } from '../../src/modules/study-stats/stats-event.queue';
import { StatsEventService } from '../../src/modules/study-stats/stats-event.service';
import { WeakPointReader } from '../../src/modules/practice/ports/weak-point.reader';
import { addDays } from '../../src/modules/study-stats/domain/calendar';
import { businessDate } from '../../src/modules/papers/domain/business-date';

process.env.THROTTLE_ENABLED = 'true';
process.env.THROTTLE_LIMIT = '1000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

type Account = { token: string; email: string; id: number };
type Progress = {
  answeredQuestionCount: number;
  questionCount: number;
  answered: number;
  correct: number;
  mastery: number | null;
};
type TreeNode = { id: string; progress: Progress | null; children: TreeNode[] };

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const node of nodes) {
    const found = node.id === id ? node : findNode(node.children, id);
    if (found) {
      return found;
    }
  }
  return undefined;
}

describe('Study tracking', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let admin: Account;
  let examId: string;
  let subjectId: string;
  let parentId: string;
  let leafA: string;
  let leafB: string;
  let otherLeaf: string;
  const singles: string[] = [];
  let sharedId: string;
  let otherId: string;
  let shortId: string;
  const users: number[] = [];
  const unique = `${Date.now()}`;
  let seq = 0;

  const as = (account: Account | null) => {
    const withAuth = (req: request.Test): request.Test => {
      req.set('X-Forwarded-For', randomIp());
      return account ? req.set('Authorization', `Bearer ${account.token}`) : req;
    };
    return {
      get: (path: string) => withAuth(api(app).get(`/api/v1${path}`)),
      post: (path: string, body?: object) => withAuth(api(app).post(`/api/v1${path}`)).send(body ?? {}),
      put: (path: string, body?: object) => withAuth(api(app).put(`/api/v1${path}`)).send(body ?? {}),
    };
  };

  const registerAndLogin = async (): Promise<Account> => {
    const email = `study.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = md5('Secret00');
    await api(app)
      .post('/api/v1/auth/email/register')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password, firstName: 'Study', lastName: 'E2E' })
      .expect(200);
    const { body } = await api(app)
      .post('/api/v1/auth/email/login')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password })
      .expect(200);
    const account = { token: body.data.token as string, email, id: Number(body.data.user.id) };
    users.push(account.id);
    return account;
  };

  const setRole = async (email: string, role: RoleEnum): Promise<void> => {
    const usersService = app.get(UsersService);
    const found = await usersService.findByEmail(email);
    if (found) {
      await usersService.update(found.id, { role: { id: role } });
    }
  };

  const createQuestion = async (body: object): Promise<string> => {
    const { body: created } = await as(admin)
      .post('/admin/questions', { subjectId, ...body })
      .expect(200);
    await as(admin).post(`/admin/questions/${created.data.id}/submit`).expect(200);
    await as(admin).post(`/admin/questions/${created.data.id}/publish`).expect(200);
    return created.data.id as string;
  };

  const single = (stem: string, knowledgePointIds: string[]): Promise<string> =>
    createQuestion({
      type: 'SINGLE',
      stem: `${stem} ${unique}`,
      options: ['A', 'B', 'C'].map((key) => ({ key, content: key })),
      answer: { keys: ['B'] },
      knowledgePointIds,
    });

  const startSession = async (account: Account, mode = 'RANDOM'): Promise<string> => {
    const { body } = await as(account)
      .post('/practice/sessions', { subjectId, mode, count: 20, deviceId: 'device-1' })
      .expect(200);
    return body.data.id as string;
  };

  const answer = (account: Account, sessionId: string, questionId: string, value: object, durationSec = 0) =>
    as(account)
      .put(`/practice/sessions/${sessionId}/answers`, {
        deviceId: 'device-1',
        answers: [
          { questionId, answer: value, durationSec, clientSeq: (seq += 1), clientAnsweredAt: new Date().toISOString() },
        ],
      })
      .expect(200);

  const recordId = async (sessionId: string, questionId: string): Promise<string> =>
    (
      await dataSource.query(`SELECT "id" FROM "answer_record" WHERE "sessionId" = $1 AND "questionId" = $2`, [
        sessionId,
        questionId,
      ])
    )[0].id;

  const apply = (id: string): Promise<boolean> => app.get(StatsEventService).applyRecord(id);

  /** 新开会话作答并计入，statDate 指定时覆盖统计日 */
  const answerAndApply = async (
    account: Account,
    questionId: string,
    correct: boolean,
    options: { statDate?: string; durationSec?: number } = {},
  ): Promise<string> => {
    const sessionId = await startSession(account);
    await answer(account, sessionId, questionId, { keys: [correct ? 'B' : 'A'] }, options.durationSec);
    const id = await recordId(sessionId, questionId);
    if (options.statDate) {
      await dataSource.query(`UPDATE "answer_record" SET "statDate" = $2 WHERE "id" = $1`, [id, options.statDate]);
    }
    await expect(apply(id)).resolves.toBe(true);
    return id;
  };

  const knowledgeStat = async (account: Account, knowledgePointId: string) =>
    (
      await dataSource.query(
        `SELECT "answered", "correct", "recentResults" FROM "user_knowledge_stat"
         WHERE "userId" = $1 AND "knowledgePointId" = $2`,
        [account.id, knowledgePointId],
      )
    )[0] as { answered: number; correct: number; recentResults: number[] } | undefined;

  const dailyStats = (account: Account) =>
    dataSource.query<{ date: string; subjectId: string; answered: number; correct: number; durationSec: number }[]>(
      `SELECT "date"::text AS "date", "subjectId", "answered", "correct", "durationSec" FROM "user_daily_stat"
       WHERE "userId" = $1 ORDER BY "date"`,
      [account.id],
    );

  const checkins = (account: Account) =>
    dataSource.query<{ date: string; reason: string }[]>(
      `SELECT "date"::text AS "date", "reason" FROM "study_checkin" WHERE "userId" = $1 ORDER BY "date"`,
      [account.id],
    );

  const knowledgeTree = async (account: Account): Promise<TreeNode[]> => {
    const { body } = await as(account).get(`/me/study/knowledge?subjectId=${subjectId}`).expect(200);
    return body.data as TreeNode[];
  };

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await app.get(PermissionsService).refreshCache();
    admin = await registerAndLogin();
    await setRole(admin.email, RoleEnum.admin);

    const exam = await as(admin)
      .post('/admin/exams', { name: 'E2E 学习统计考试', category: 'CIVIL_SERVICE' })
      .expect(200);
    examId = exam.body.data.id;
    await as(admin).post(`/admin/exams/${examId}/publish`).expect(200);
    const subject = await as(admin).post('/admin/subjects', { examId, name: '行测' }).expect(200);
    subjectId = subject.body.data.id;
    await as(admin).post(`/admin/subjects/${subjectId}/publish`).expect(200);
    const point = async (parent: string | null, name: string): Promise<string> =>
      (await as(admin).post('/admin/knowledge-points', { subjectId, parentId: parent, name }).expect(200)).body.data
        .id as string;
    parentId = await point(null, '常识');
    leafA = await point(parentId, '法律');
    leafB = await point(parentId, '历史');
    otherLeaf = await point(null, '数量');

    for (const name of ['甲', '乙', '丙']) {
      singles.push(await single(`法律${name}`, [leafA]));
    }
    sharedId = await single('法律历史', [leafA, leafB]);
    otherId = await single('数量', [otherLeaf]);
    shortId = await createQuestion({
      type: 'SHORT_ANSWER',
      stem: `简答 ${unique}`,
      answer: { reference: '参考答案', points: ['要点一'] },
      knowledgePointIds: [leafB],
    });
  }, 120_000);

  beforeEach(() => {
    vi.spyOn(app.get(StatsEventQueue), 'publishRecord').mockResolvedValue(undefined);
    vi.spyOn(app.get(StatsEventQueue), 'publishSession').mockResolvedValue(undefined);
    vi.spyOn(app.get(StatsEventQueue), 'publishCheckIn').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      if (users.length > 0) {
        await dataSource.query(`DELETE FROM "study_checkin" WHERE "userId" = ANY($1::int[])`, [users]);
      }
      if (subjectId) {
        await dataSource.query(`DELETE FROM "daily_question_set" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "practice_session" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "user_daily_stat" WHERE "subjectId" = $1`, [subjectId]);
        const owned = `SELECT "id" FROM "question" WHERE "subjectId" = $1`;
        await dataSource.query(`DELETE FROM "wrong_question" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(`DELETE FROM "question_version" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(`DELETE FROM "question" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(
          `DELETE FROM "user_knowledge_stat" WHERE "knowledgePointId" IN
             (SELECT "id" FROM "knowledge_point" WHERE "subjectId" = $1)`,
          [subjectId],
        );
        await dataSource.query(`DELETE FROM "knowledge_point" WHERE "subjectId" = $1 AND "level" = 3`, [subjectId]);
        await dataSource.query(`DELETE FROM "knowledge_point" WHERE "subjectId" = $1 AND "level" = 2`, [subjectId]);
        await dataSource.query(`DELETE FROM "knowledge_point" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "subject" WHERE "id" = $1`, [subjectId]);
      }
      if (examId) {
        await dataSource.query(`DELETE FROM "user_exam_profile" WHERE "examId" = $1`, [examId]);
        await dataSource.query(`DELETE FROM "exam" WHERE "id" = $1`, [examId]);
      }
      await setRole(admin.email, RoleEnum.user);
    } finally {
      await app?.close();
    }
  });

  it('should keep the latest twenty results of a leaf and compute its mastery', async () => {
    const user = await registerAndLogin();
    for (let i = 0; i < 2; i += 1) {
      await answerAndApply(user, singles[0], false);
    }
    for (let i = 0; i < 20; i += 1) {
      await answerAndApply(user, singles[i % 2], true);
    }

    const stat = await knowledgeStat(user, leafA);
    expect(stat).toMatchObject({ answered: 22, correct: 20 });
    expect(stat?.recentResults).toEqual(Array<number>(20).fill(1));

    const leaf = findNode(await knowledgeTree(user), leafA);
    expect(leaf?.progress).toMatchObject({ answered: 22, correct: 20, answeredQuestionCount: 2, mastery: 97.27 });
  }, 120_000);

  it('should aggregate a parent once per answer when the question is linked to two of its leaves', async () => {
    const user = await registerAndLogin();
    for (let i = 0; i < 5; i += 1) {
      await answerAndApply(user, sharedId, true);
    }

    expect(await knowledgeStat(user, leafA)).toMatchObject({ answered: 5, correct: 5 });
    expect(await knowledgeStat(user, leafB)).toMatchObject({ answered: 5, correct: 5 });
    const tree = await knowledgeTree(user);
    expect(findNode(tree, parentId)?.progress).toEqual({
      answeredQuestionCount: 1,
      questionCount: 5,
      answered: 5,
      correct: 5,
      mastery: 100,
    });
    expect(findNode(tree, leafB)?.progress).toEqual({
      answeredQuestionCount: 1,
      questionCount: 2,
      answered: 5,
      correct: 5,
      mastery: 100,
    });
    expect(findNode(tree, otherLeaf)?.progress).toEqual({
      answeredQuestionCount: 0,
      questionCount: 1,
      answered: 0,
      correct: 0,
      mastery: null,
    });

    await answerAndApply(user, singles[2], false);
    expect(findNode(await knowledgeTree(user), parentId)?.progress).toMatchObject({
      answeredQuestionCount: 2,
      answered: 6,
      correct: 5,
      mastery: 83.33,
    });

    const member = await as(user).get(`/subjects/${subjectId}/knowledge-points`).expect(200);
    expect(findNode(member.body.data as TreeNode[], parentId)?.progress).toMatchObject({ answered: 6 });
    const guest = await as(null).get(`/subjects/${subjectId}/knowledge-points`).expect(200);
    expect(findNode(guest.body.data as TreeNode[], parentId)?.progress).toBeNull();

    const offlineId = await single('法律下架', [leafA]);
    await answerAndApply(user, offlineId, true);
    await as(admin).post(`/admin/questions/${offlineId}/offline`).expect(200);
    await answerAndApply(user, singles[2], true);
    expect(findNode(await knowledgeTree(user), parentId)?.progress).toMatchObject({
      answeredQuestionCount: 2,
      answered: 8,
      correct: 7,
    });
  }, 120_000);

  it('should record daily statistics on the stat date with per answer durations', async () => {
    const user = await registerAndLogin();
    await answerAndApply(user, singles[0], true, { statDate: '2026-09-01', durationSec: 30 });
    await answerAndApply(user, otherId, false, { statDate: '2026-09-01', durationSec: 15 });
    const recordIdToday = await answerAndApply(user, singles[1], true, { durationSec: 5 });
    const [{ statDate }] = await dataSource.query(
      `SELECT "statDate"::text AS "statDate" FROM "answer_record" WHERE "id" = $1`,
      [recordIdToday],
    );

    expect(await dailyStats(user)).toEqual([
      { date: '2026-09-01', subjectId, answered: 2, correct: 1, durationSec: 45 },
      { date: statDate, subjectId, answered: 1, correct: 1, durationSec: 5 },
    ]);

    const { body } = await as(user).get('/me/study/daily?from=2026-08-31&to=2026-09-02').expect(200);
    expect(body.data).toEqual([
      { date: '2026-08-31', answered: 0, correct: 0, durationSec: 0, subjects: [] },
      {
        date: '2026-09-01',
        answered: 2,
        correct: 1,
        durationSec: 45,
        subjects: [{ subjectId, answered: 2, correct: 1, durationSec: 45 }],
      },
      { date: '2026-09-02', answered: 0, correct: 0, durationSec: 0, subjects: [] },
    ]);
    await as(user).get('/me/study/daily?from=2026-09-03&to=2026-09-01').expect(422);
    await as(user).get('/me/study/daily?from=2026-9-1').expect(422);
    await as(null).get('/me/study/daily').expect(401);
  }, 120_000);

  it('should add the mock session duration once on the submission day', async () => {
    const user = await registerAndLogin();
    const [{ id: sessionId }] = await dataSource.query(
      `INSERT INTO "practice_session"
         ("userId", "subjectId", "mode", "questionIds", "questionVersions", "status", "submittedAt", "durationSec",
          "answeredCount")
       VALUES ($1, $2, 'MOCK', $3, $4, 'SUBMITTED', '2026-09-04T16:30:00Z', 3600, 3)
       RETURNING "id"`,
      [user.id, subjectId, [singles[0], singles[1], shortId], { [singles[0]]: 1, [singles[1]]: 1, [shortId]: 1 }],
    );
    const insertRecord = async (questionId: string, isCorrect: boolean | null): Promise<string> =>
      (
        await dataSource.query(
          `INSERT INTO "answer_record"
             ("sessionId", "userId", "questionId", "questionVersion", "answer", "isCorrect", "durationSec", "deviceId",
              "clientAnsweredAt", "gradedAt", "statDate")
           VALUES ($1, $2, $3, 1, '{}', $4, 900, 'device-1', now(), CASE WHEN $4::boolean IS NULL THEN NULL ELSE now() END,
                   CASE WHEN $4::boolean IS NULL THEN NULL ELSE '2026-09-05'::date END)
           RETURNING "id"`,
          [sessionId, user.id, questionId, isCorrect],
        )
      )[0].id as string;
    const objectiveIds = [await insertRecord(singles[0], true), await insertRecord(singles[1], false)];
    const subjectiveId = await insertRecord(shortId, null);

    await expect(app.get(StatsEventService).processSession(sessionId)).resolves.toBe('done');
    expect(await dailyStats(user)).toEqual([
      { date: '2026-09-05', subjectId, answered: 2, correct: 1, durationSec: 3600 },
    ]);

    for (const id of objectiveIds) {
      await expect(apply(id)).resolves.toBe(false);
    }
    await dataSource.query(
      `UPDATE "answer_record" SET "isCorrect" = true, "selfAssessment" = 'KNOWN', "gradedAt" = now(),
         "statDate" = '2026-09-05' WHERE "id" = $1`,
      [subjectiveId],
    );
    await expect(apply(subjectiveId)).resolves.toBe(true);
    expect(await dailyStats(user)).toEqual([
      { date: '2026-09-05', subjectId, answered: 3, correct: 2, durationSec: 3600 },
    ]);
  });

  it('should check in when the answers of the current exam reach the daily goal and count the streak', async () => {
    const user = await registerAndLogin();
    await as(user).put(`/me/exam-profiles/${examId}`, { dailyGoal: 2, examDate: '2099-01-01' }).expect(200);
    const today = businessDate();
    const yesterday = addDays(today, -1);
    const dayBefore = addDays(today, -2);
    await dataSource.query(`INSERT INTO "study_checkin" ("userId", "date", "reason") VALUES ($1, $2, 'GOAL_REACHED')`, [
      user.id,
      addDays(today, -4),
    ]);

    await answerAndApply(user, singles[0], true, { statDate: dayBefore });
    expect(await checkins(user)).toEqual([{ date: addDays(today, -4), reason: 'GOAL_REACHED' }]);
    await answerAndApply(user, singles[1], false, { statDate: dayBefore });
    await answerAndApply(user, singles[0], true, { statDate: yesterday });
    await answerAndApply(user, singles[2], true, { statDate: yesterday });
    await answerAndApply(user, singles[2], true, { statDate: yesterday });
    await answerAndApply(user, singles[1], true);
    expect(await checkins(user)).toEqual([
      { date: addDays(today, -4), reason: 'GOAL_REACHED' },
      { date: dayBefore, reason: 'GOAL_REACHED' },
      { date: yesterday, reason: 'GOAL_REACHED' },
    ]);

    const overview = await as(user).get('/me/study/overview').expect(200);
    expect(overview.body.data).toMatchObject({
      date: today,
      todayAnswered: 1,
      todayCorrect: 1,
      dailyGoal: 2,
      checkedInToday: false,
      streakDays: 2,
      examId,
      examDate: '2099-01-01',
      totalAnswered: 6,
    });
    expect(overview.body.data.daysUntilExam).toBeGreaterThan(0);

    const calendar = await as(user)
      .get(`/me/checkins?month=${yesterday.slice(0, 7)}`)
      .expect(200);
    expect(calendar.body.data).toMatchObject({ month: yesterday.slice(0, 7), streakDays: 2, checkedInToday: false });
    expect(calendar.body.data.days).toContainEqual({ date: yesterday, reason: 'GOAL_REACHED' });
    await as(user).get('/me/checkins?month=2026-13').expect(422);
  }, 120_000);

  it('should check in when every daily objective question is graded and every subjective one is answered on that day', async () => {
    const user = await registerAndLogin();
    const today = businessDate();
    await dataSource.query(
      `INSERT INTO "daily_question_set" ("subjectId", "date", "questionIds") VALUES ($1, $2, $3)
       ON CONFLICT ("subjectId", "date") DO UPDATE SET "questionIds" = EXCLUDED."questionIds"`,
      [subjectId, today, [singles[0], shortId]],
    );
    const sessionId = await startSession(user, 'DAILY');
    const publishCheckIn = vi.mocked(app.get(StatsEventQueue).publishCheckIn);

    await answer(user, sessionId, singles[0], { keys: ['A'] });
    const objectiveId = await recordId(sessionId, singles[0]);
    await expect(apply(objectiveId)).resolves.toBe(true);
    expect(publishCheckIn).not.toHaveBeenCalled();
    expect(await checkins(user)).toEqual([]);

    await answer(user, sessionId, shortId, { text: '作答' });
    expect(publishCheckIn).toHaveBeenCalledWith(user.id, today);

    await dataSource.query(`UPDATE "answer_record" SET "statDate" = $2 WHERE "id" = $1`, [
      objectiveId,
      addDays(today, -1),
    ]);
    await expect(app.get(StatsEventService).processCheckIn(user.id, today)).resolves.toBe('done');
    expect(await checkins(user)).toEqual([]);

    await dataSource.query(`UPDATE "answer_record" SET "statDate" = $2 WHERE "id" = $1`, [objectiveId, today]);
    await expect(app.get(StatsEventService).processCheckIn(user.id, today)).resolves.toBe('done');
    expect(await checkins(user)).toEqual([{ date: today, reason: 'DAILY_DONE' }]);

    const overview = await as(user).get('/me/study/overview').expect(200);
    expect(overview.body.data).toMatchObject({ checkedInToday: true, streakDays: 1, dailyGoal: null, examId: null });
  });

  it('should list weak leaves and provide them to smart practice', async () => {
    const user = await registerAndLogin();
    for (let i = 0; i < 5; i += 1) {
      await answerAndApply(user, otherId, i === 0);
    }
    for (let i = 0; i < 4; i += 1) {
      await answerAndApply(user, singles[0], false);
    }

    const { body } = await as(user).get(`/me/study/weak-points?subjectId=${subjectId}`).expect(200);
    expect(body.data).toEqual([
      { knowledgePointId: otherLeaf, name: '数量', path: `/${otherLeaf}/`, answered: 5, correct: 1, mastery: 20 },
    ]);
    await expect(
      app.get(WeakPointReader, { strict: false }).findWeakKnowledgePointIds(user.id, subjectId),
    ).resolves.toEqual([otherLeaf]);
    await as(user).get('/me/study/weak-points').expect(422);
    await as(user).get('/me/study/knowledge?subjectId=00000000-0000-4000-8000-000000000000').expect(404);
  }, 120_000);
});
