// 需在独立的测试数据库与 Redis 上运行：会注册测试用户并写入考试、科目、知识点、题目、每日一练题组与练习会话
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { md5 } from '../utils/constants';
import { createTestApp, randomIp } from '../utils/test-app';
import { deletePracticeSessions } from '../utils/practice-sessions';
import { UsersService } from '../../src/core/users/users.service';
import { PermissionsService } from '../../src/core/permissions/permissions.service';
import { RoleEnum } from '../../src/common/enums/roles/roles.enum';
import { businessDate } from '../../src/modules/papers/domain/business-date';
import { QuestionAssociationReader } from '../../src/modules/practice/ports/question-association.reader';
import { PracticeSessionRepository } from '../../src/modules/practice/infrastructure/persistence/practice-session.repository';
import { PracticeMode } from '../../src/modules/practice/domain/practice-mode';

process.env.THROTTLE_ENABLED = 'true';
process.env.THROTTLE_LIMIT = '1000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

type Account = { token: string; email: string; id: number };
type CardItem = { index: number; questionId: string; materialId: string | null; answered: boolean };
type SessionBody = {
  id: string;
  mode: string;
  status: string;
  questionCount: number;
  answeredCount: number;
  correctCount: number;
  insufficient?: boolean;
  card: CardItem[];
};
type PracticeQuestion = {
  id: string;
  type: string;
  answerState: { answer: unknown; isCorrect: boolean | null; markedForReview: boolean } | null;
  solution: { answer: unknown; analysis: string | null } | null;
  hiddenReason: string | null;
  children?: PracticeQuestion[];
};

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

async function registerAndLogin(app: NestExpressApplication): Promise<Account> {
  const email = `practice.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = md5('Secret00');
  await api(app)
    .post('/api/v1/auth/email/register')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password, firstName: 'Practice', lastName: 'E2E' })
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

describe('Practice sessions', () => {
  let app: NestExpressApplication;
  let admin: Account;
  let user: Account;
  let other: Account;
  let examId: string;
  let subjectId: string;
  let otherSubjectId: string;
  let otherLeaf: string;
  let leaf1: string;
  let leaf2: string;
  const singles: string[] = [];
  let judgeId: string;
  let fillId: string;
  let shortId: string;
  let materialId: string;
  let subIds: string[];
  let draftId: string;
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
      delete: (path: string) => withAuth(api(app).delete(`/api/v1${path}`)),
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

  const options = [
    { key: 'A', content: '甲' },
    { key: 'B', content: '乙' },
    { key: 'C', content: '丙' },
  ];
  const single = (stem: string, knowledgePointId: string, extra: object = {}): object => ({
    subjectId,
    type: 'SINGLE',
    stem: `${stem} ${unique}`,
    options,
    answer: { keys: ['B'] },
    analysis: `${stem}解析`,
    knowledgePointIds: [knowledgePointId],
    ...extra,
  });

  const createSession = (body: object, account: Account = user) =>
    as(account).post('/practice/sessions', { subjectId, deviceId: 'device-1', ...body });

  const answer = (sessionId: string, items: object[], account: Account = user) =>
    as(account).put(`/practice/sessions/${sessionId}/answers`, {
      deviceId: 'device-1',
      answers: items.map((item) => ({ clientSeq: (seq += 1), clientAnsweredAt: new Date().toISOString(), ...item })),
    });

  const segment = async (sessionId: string, from = 0, size = 50): Promise<PracticeQuestion[]> => {
    const { body } = await as(user)
      .get(`/practice/sessions/${sessionId}/questions?from=${from}&size=${size}`)
      .expect(200);
    return (body.data.units as PracticeQuestion[]).flatMap((unit) => unit.children ?? [unit]);
  };

  const setDailyQuestions = async (questionIds: string[]): Promise<void> => {
    await app.get(DataSource).query(
      `INSERT INTO "daily_question_set" ("subjectId", "date", "questionIds") VALUES ($1, $2, $3)
       ON CONFLICT ("subjectId", "date") DO UPDATE SET "questionIds" = EXCLUDED."questionIds"`,
      [subjectId, businessDate(), questionIds],
    );
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(PermissionsService).refreshCache();
    user = await registerAndLogin(app);
    other = await registerAndLogin(app);
    admin = await registerAndLogin(app);
    await setRole(app, admin.email, RoleEnum.admin);

    const exam = await as(admin).post('/admin/exams', { name: 'E2E 练习考试', category: 'CIVIL_SERVICE' }).expect(200);
    examId = exam.body.data.id;
    await as(admin).post(`/admin/exams/${examId}/publish`).expect(200);
    const subject = await as(admin).post('/admin/subjects', { examId, name: '行测' }).expect(200);
    subjectId = subject.body.data.id;
    await as(admin).post(`/admin/subjects/${subjectId}/publish`).expect(200);
    const otherSubject = await as(admin).post('/admin/subjects', { examId, name: '申论' }).expect(200);
    otherSubjectId = otherSubject.body.data.id;
    const otherPoint = await as(admin)
      .post('/admin/knowledge-points', { subjectId: otherSubjectId, parentId: null, name: '其他' })
      .expect(200);
    otherLeaf = otherPoint.body.data.id;
    const branch = await as(admin).post('/admin/knowledge-points', { subjectId, parentId: null, name: '常识' });
    leaf1 = (
      await as(admin)
        .post('/admin/knowledge-points', { subjectId, parentId: branch.body.data.id, name: '法律' })
        .expect(200)
    ).body.data.id;
    leaf2 = (
      await as(admin)
        .post('/admin/knowledge-points', { subjectId, parentId: branch.body.data.id, name: '资料' })
        .expect(200)
    ).body.data.id;

    for (const name of ['甲', '乙', '丙', '丁']) {
      singles.push(await createQuestion(single(`单选${name}`, leaf1), true));
    }
    judgeId = await createQuestion(
      { subjectId, type: 'JUDGE', stem: `判断 ${unique}`, answer: { value: true }, knowledgePointIds: [leaf1] },
      true,
    );
    fillId = await createQuestion(
      {
        subjectId,
        type: 'FILL',
        stem: `填空 ${unique}`,
        answer: { blanks: [['ABC'], ['北京']] },
        analysis: '填空解析',
        knowledgePointIds: [leaf1],
      },
      true,
    );
    shortId = await createQuestion(
      {
        subjectId,
        type: 'SHORT_ANSWER',
        stem: `简答 ${unique}`,
        answer: { reference: '参考答案', points: ['要点一', '要点二'] },
        knowledgePointIds: [leaf2],
      },
      true,
    );
    materialId = await createQuestion(
      { subjectId, type: 'MATERIAL', stem: `资料 ${unique}`, material: `材料正文 ${unique}` },
      false,
    );
    subIds = [];
    for (const [index, name] of ['小题一', '小题二', '小题三'].entries()) {
      subIds.push(await createQuestion({ ...single(name, leaf2), parentId: materialId, sort: index }, false));
    }
    await as(admin).post(`/admin/questions/${materialId}/submit`).expect(200);
    await as(admin).post(`/admin/questions/${materialId}/publish`).expect(200);
    draftId = await createQuestion(single('草稿', leaf1), false);
  }, 180_000);

  afterAll(async () => {
    try {
      const dataSource = app.get(DataSource);
      if (subjectId) {
        await deletePracticeSessions(app, [subjectId, otherSubjectId]);
        await dataSource.query(`DELETE FROM "daily_question_set" WHERE "subjectId" = $1`, [subjectId]);
        const owned = `SELECT "id" FROM "question" WHERE "subjectId" = $1`;
        await dataSource.query(`DELETE FROM "question_version" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(`DELETE FROM "question" WHERE "subjectId" = $1 AND "parentId" IS NOT NULL`, [subjectId]);
        await dataSource.query(`DELETE FROM "question" WHERE "subjectId" = $1`, [subjectId]);
        for (const id of [subjectId, otherSubjectId]) {
          for (const level of [3, 2, 1]) {
            await dataSource.query(`DELETE FROM "knowledge_point" WHERE "subjectId" = $1 AND "level" = $2`, [
              id,
              level,
            ]);
          }
          await dataSource.query(`DELETE FROM "subject" WHERE "id" = $1`, [id]);
        }
      }
      if (examId) {
        await dataSource.query(`DELETE FROM "exam" WHERE "id" = $1`, [examId]);
      }
      await setRole(app, admin.email, RoleEnum.user);
    } finally {
      await app?.close();
    }
  });

  it('should require login for practice endpoints', async () => {
    await as(null).post('/practice/sessions', { subjectId, mode: 'RANDOM', deviceId: 'd' }).expect(401);
    await as(null).get('/practice/sessions').expect(401);
    await as(null).get(`/questions/${singles[0]}`).expect(401);
    await as(user).get('/practice/sessions/not-a-uuid').expect(400);
  });

  describe('creation', () => {
    it('should create a chapter session within the knowledge point and report insufficient questions', async () => {
      const leaf1Questions = [...singles, judgeId, fillId];
      const small = await createSession({ mode: 'CHAPTER', scope: { knowledgePointId: leaf1 }, count: 3 }).expect(200);
      expect(small.body.data).toMatchObject({
        mode: 'CHAPTER',
        status: 'IN_PROGRESS',
        questionCount: 3,
        insufficient: false,
      });
      const smallIds = (small.body.data as SessionBody).card.map((item) => item.questionId);
      expect(smallIds.every((id) => leaf1Questions.includes(id))).toBe(true);

      const large = await createSession({ mode: 'CHAPTER', scope: { knowledgePointId: leaf1 }, count: 50 }).expect(200);
      expect(large.body.data).toMatchObject({ questionCount: leaf1Questions.length, insufficient: true });
      expect(large.body.data.serverNow).toBeDefined();

      await createSession({ mode: 'CHAPTER', scope: { knowledgePointId: otherLeaf } }).expect(422);
      await createSession({ mode: 'CHAPTER' }).expect(422);
      for (const id of [small.body.data.id, large.body.data.id]) {
        await as(user).post(`/practice/sessions/${id}/abandon`).expect(200);
      }
    });

    it('should keep material sub-questions complete and contiguous in random practice', async () => {
      const { body } = await createSession({ mode: 'RANDOM', count: 100 }).expect(200);
      const card = (body.data as SessionBody).card;
      expect(card).toHaveLength(10);
      const first = card.findIndex((item) => item.materialId === materialId);
      expect(card.slice(first, first + 3).map((item) => item.questionId)).toEqual(subIds);
      await as(user).post(`/practice/sessions/${body.data.id}/abandon`).expect(200);
    });

    it('should draw by question type and fill smart practice with unanswered questions', async () => {
      const typed = await createSession({ mode: 'TYPE', scope: { questionType: 'JUDGE' } }).expect(200);
      expect((typed.body.data as SessionBody).card.map((item) => item.questionId)).toEqual([judgeId]);
      expect(typed.body.data.insufficient).toBe(true);
      await createSession({ mode: 'TYPE' }).expect(422);

      const smart = await createSession({ mode: 'SMART', count: 5 }, other).expect(200);
      expect(smart.body.data).toMatchObject({ mode: 'SMART', insufficient: false });
      expect(smart.body.data.questionCount).toBeGreaterThanOrEqual(5);
      for (const [account, id] of [
        [user, typed.body.data.id],
        [other, smart.body.data.id],
      ] as const) {
        await as(account).post(`/practice/sessions/${id}/abandon`).expect(200);
      }
    });

    it('should reject unsupported modes, papers and empty wrong books', async () => {
      await createSession({ mode: 'MOCK', paperId: examId }).expect(422);
      await createSession({ mode: 'FAVORITE' }).expect(422);
      await createSession({ mode: 'MEMORIZE', scope: { knowledgePointId: leaf2 }, paperId: examId }).expect(422);
      await createSession({ mode: 'WRONG' })
        .expect(422)
        .expect(({ body }) => expect(body.data.errorKey).toBe('noQuestionsAvailable'));
      await createSession({ mode: 'RANDOM', subjectId: otherSubjectId }).expect(422);
    });

    it('should show answers directly in memorize mode without accepting answers', async () => {
      const { body } = await createSession({ mode: 'MEMORIZE', scope: { knowledgePointId: leaf2 } }).expect(200);
      const questions = await segment(body.data.id);
      expect(questions.map((question) => question.id).sort()).toEqual([shortId, ...subIds].sort());
      const sub = questions.find((question) => question.id === subIds[0])!;
      expect(sub.solution).toEqual({ answer: { keys: ['B'] }, analysis: '小题一解析' });
      expect(questions.find((question) => question.id === shortId)!.solution?.answer).toEqual({
        reference: '参考答案',
        points: ['要点一', '要点二'],
      });
      await answer(body.data.id, [{ questionId: subIds[0], answer: { keys: ['B'] } }]).expect(422);
      await as(user).post(`/practice/sessions/${body.data.id}/submit`).expect(200);
    });
  });

  describe('immediate grading', () => {
    let sessionId: string;

    beforeAll(async () => {
      const { body } = await createSession({ mode: 'RANDOM', count: 100 }).expect(200);
      sessionId = body.data.id;
    });

    it('should hide answers before answering', async () => {
      const questions = await segment(sessionId);
      expect(questions.every((question) => question.solution === null && question.answerState === null)).toBe(true);
      const { body } = await as(user).get(`/practice/sessions/${sessionId}/questions?from=0&size=50`).expect(200);
      expect(JSON.stringify(body.data)).not.toMatch(/"analysis"|参考答案|"keys"/);
    });

    it('should grade objective answers on first submit and return the first result on resubmit', async () => {
      const first = await answer(sessionId, [
        { questionId: singles[0], answer: { keys: ['A'] }, durationSec: 30 },
      ]).expect(200);
      expect(first.body.data.results[0]).toMatchObject({
        questionId: singles[0],
        answerState: { answer: { keys: ['A'] }, isCorrect: false, durationSec: 30 },
        solution: { answer: { keys: ['B'] }, analysis: '单选甲解析' },
        hiddenReason: null,
      });

      const again = await answer(sessionId, [{ questionId: singles[0], answer: { keys: ['B'] } }]).expect(200);
      expect(again.body.data.results[0].answerState).toMatchObject({ answer: { keys: ['A'] }, isCorrect: false });

      const fill = await answer(sessionId, [{ questionId: fillId, answer: { blanks: ['ａｂｃ ', '北京'] } }]).expect(
        200,
      );
      expect(fill.body.data.results[0].answerState.isCorrect).toBe(true);

      const detail = await as(user).get(`/practice/sessions/${sessionId}`).expect(200);
      expect(detail.body.data).toMatchObject({ answeredCount: 2, correctCount: 1, durationSec: 30 });
      expect(detail.body.data.card.find((item: CardItem) => item.questionId === singles[0])).toMatchObject({
        answered: true,
        isCorrect: false,
      });
    });

    it('should save a mark without counting it as answered', async () => {
      const marked = await answer(sessionId, [{ questionId: singles[1], markedForReview: true }]).expect(200);
      expect(marked.body.data.results[0]).toMatchObject({
        answerState: { answer: null, isCorrect: null, markedForReview: true },
        solution: null,
      });
      const empty = await answer(sessionId, [{ questionId: singles[2], answer: { keys: [] } }]).expect(200);
      expect(empty.body.data.results[0].answerState).toBeNull();
      const detail = await as(user).get(`/practice/sessions/${sessionId}`).expect(200);
      expect(detail.body.data.answeredCount).toBe(2);
      expect(detail.body.data.card.find((item: CardItem) => item.questionId === singles[1])).toMatchObject({
        answered: false,
        markedForReview: true,
      });
    });

    it('should return the reference answer for subjective answers and lock the self-assessment', async () => {
      await as(user)
        .post(`/practice/sessions/${sessionId}/self-assessment`, { questionId: shortId, selfAssessment: 'KNOWN' })
        .expect(409)
        .expect(({ body }) => expect(body.data.errorKey).toBe('selfAssessmentNotAllowed'));

      const submitted = await answer(sessionId, [{ questionId: shortId, answer: { text: '我的作答' } }]).expect(200);
      expect(submitted.body.data.results[0]).toMatchObject({
        answerState: { answer: { text: '我的作答' }, isCorrect: null },
        solution: { answer: { reference: '参考答案', points: ['要点一', '要点二'] } },
      });

      const assessed = await as(user)
        .post(`/practice/sessions/${sessionId}/self-assessment`, { questionId: shortId, selfAssessment: 'UNKNOWN' })
        .expect(200);
      expect(assessed.body.data.answerState).toMatchObject({ selfAssessment: 'UNKNOWN', isCorrect: false });
      const again = await as(user)
        .post(`/practice/sessions/${sessionId}/self-assessment`, { questionId: shortId, selfAssessment: 'KNOWN' })
        .expect(200);
      expect(again.body.data.answerState).toMatchObject({ selfAssessment: 'UNKNOWN', isCorrect: false });
      await as(user)
        .post(`/practice/sessions/${sessionId}/self-assessment`, { questionId: singles[0], selfAssessment: 'KNOWN' })
        .expect(422);

      const detail = await as(user).get(`/practice/sessions/${sessionId}`).expect(200);
      expect(detail.body.data).toMatchObject({ answeredCount: 3, correctCount: 1 });
    });

    it('should serialize concurrent answer writes of one session and keep the counters', async () => {
      const { body } = await createSession({ mode: 'RANDOM', count: 100 }).expect(200);
      const concurrentId = body.data.id as string;
      const items = [
        ...singles.map((questionId) => ({ questionId, answer: { keys: ['B'] } })),
        { questionId: judgeId, answer: { value: false } },
      ];
      const responses = await Promise.all(items.map((item) => answer(concurrentId, [item])));
      expect(responses.map((response) => response.status)).toEqual(items.map(() => 200));

      const detail = await as(user).get(`/practice/sessions/${concurrentId}`).expect(200);
      expect(detail.body.data).toMatchObject({ answeredCount: 5, correctCount: 4 });
      await as(user).post(`/practice/sessions/${concurrentId}/abandon`).expect(200);
    });

    it('should reject answers that do not match the question', async () => {
      await answer(sessionId, [{ questionId: singles[3], answer: { keys: ['Z'] } }])
        .set('Accept-Language', 'zh')
        .expect(422)
        .expect(({ body }) => expect(body.data.answers).toContain('作答与题目不符'));
      await answer(sessionId, [{ questionId: fillId, answer: { blanks: ['ABC'] } }]).expect(422);
    });

    it('should align segments to material boundaries', async () => {
      const detail = await as(user).get(`/practice/sessions/${sessionId}`).expect(200);
      const card = detail.body.data.card as CardItem[];
      const firstSub = card.find((item) => item.questionId === subIds[0])!.index;
      const { body } = await as(user)
        .get(`/practice/sessions/${sessionId}/questions?from=${firstSub + 1}&size=1`)
        .expect(200);
      expect(body.data).toMatchObject({ from: firstSub, size: 3, total: card.length });
      expect(body.data.units).toHaveLength(1);
      expect(body.data.units[0]).toMatchObject({ id: materialId, type: 'MATERIAL', material: `材料正文 ${unique}` });
      expect(body.data.units[0].children.map((child: PracticeQuestion) => child.id)).toEqual(subIds);
    });

    it('should record progress, list sessions and finish the practice', async () => {
      await as(user).post(`/practice/sessions/${sessionId}/progress`, { lastIndex: 2 }).expect(200);
      await as(user).post(`/practice/sessions/${sessionId}/progress`, { lastIndex: 999 }).expect(422);
      const ongoing = await as(user).get('/practice/sessions/ongoing').expect(200);
      expect(ongoing.body.data[0]).toMatchObject({ id: sessionId, lastIndex: 2 });
      const history = await as(user).get('/practice/sessions?mode=RANDOM&status=IN_PROGRESS').expect(200);
      expect(history.body.data.list.map((item: { id: string }) => item.id)).toEqual([sessionId]);

      await as(other).get(`/practice/sessions/${sessionId}`).expect(404);
      await answer(sessionId, [{ questionId: singles[3], answer: { keys: ['B'] } }], other).expect(404);

      const submitted = await as(user).post(`/practice/sessions/${sessionId}/submit`).expect(200);
      expect(submitted.body.data).toMatchObject({ status: 'SUBMITTED', submitType: 'MANUAL' });
      await as(user).post(`/practice/sessions/${sessionId}/submit`).expect(200);
      await answer(sessionId, [{ questionId: singles[3], answer: { keys: ['B'] } }])
        .expect(409)
        .expect(({ body }) => expect(body.data.errorKey).toBe('sessionClosed'));
      await as(user).post(`/practice/sessions/${sessionId}/abandon`).expect(200);
      const detail = await as(user).get(`/practice/sessions/${sessionId}`).expect(200);
      expect(detail.body.data.status).toBe('SUBMITTED');
    });

    it('should redo wrong questions of a finished session', async () => {
      const { body } = await createSession({ mode: 'WRONG', scope: { fromSessionId: sessionId } }).expect(200);
      expect((body.data as SessionBody).card.map((item) => item.questionId).sort()).toEqual(
        [singles[0], shortId].sort(),
      );
      await as(user).post(`/practice/sessions/${body.data.id}/abandon`).expect(200);
      await createSession({ mode: 'WRONG', scope: { fromSessionId: sessionId } }, other).expect(422);
    });

    it('should reject deleting a question referenced by an answer record', async () => {
      await app.get(DataSource).query(
        `INSERT INTO "answer_record" ("sessionId", "userId", "questionId", "questionVersion", "deviceId", "clientAnsweredAt")
         VALUES ($1, $2, $3, 0, 'device-1', now())`,
        [sessionId, user.id, draftId],
      );
      try {
        await as(admin).delete(`/admin/questions/${draftId}`).expect(409);
      } finally {
        await app.get(DataSource).query(`DELETE FROM "answer_record" WHERE "questionId" = $1`, [draftId]);
      }
    });
  });

  describe('daily practice', () => {
    it('should return the same daily session on re-entry and forbid finishing or abandoning it', async () => {
      await setDailyQuestions([singles[3], ...subIds]);
      const first = await createSession({ mode: 'DAILY' }).expect(200);
      await answer(first.body.data.id, [{ questionId: singles[3], answer: { keys: ['B'] } }]).expect(200);
      const again = await createSession({ mode: 'DAILY' }).expect(200);
      expect(again.body.data).toMatchObject({
        id: first.body.data.id,
        mode: 'DAILY',
        answeredCount: 1,
        correctCount: 1,
        questionCount: 4,
      });

      await as(user)
        .post(`/practice/sessions/${first.body.data.id}/abandon`)
        .expect(409)
        .expect(({ body }) => expect(body.data.errorKey).toBe('dailySessionCannotAbandon'));
      await as(user)
        .post(`/practice/sessions/${first.body.data.id}/submit`)
        .expect(409)
        .expect(({ body }) => expect(body.data.errorKey).toBe('dailySessionCannotFinish'));
      await as(admin).post(`/admin/subjects/${subjectId}/daily-sets/${businessDate()}/regenerate`).expect(409);

      const otherDaily = await createSession({ mode: 'DAILY' }, other).expect(200);
      expect(otherDaily.body.data.id).not.toBe(first.body.data.id);
    });

    it('should list the daily session as ongoing unless daily mode is excluded', async () => {
      const daily = await createSession({ mode: 'DAILY' }).expect(200);
      const ids = (body: { data: { id: string }[] }) => body.data.map((item) => item.id);

      const all = await as(user).get('/practice/sessions/ongoing').expect(200);
      expect(ids(all.body)).toContain(daily.body.data.id);

      const excluded = await as(user).get('/practice/sessions/ongoing?excludeModes=DAILY').expect(200);
      expect(ids(excluded.body)).not.toContain(daily.body.data.id);
      expect(excluded.body.data.length).toBe(all.body.data.length - 1);

      const several = await as(user).get('/practice/sessions/ongoing?excludeModes=DAILY,RANDOM').expect(200);
      const modes = several.body.data.map((item: { mode: string }) => item.mode);
      expect(modes).not.toContain('DAILY');
      expect(modes).not.toContain('RANDOM');

      await as(user).get('/practice/sessions/ongoing?excludeModes=UNKNOWN').expect(422);
    });
  });

  describe('answer visibility with an ongoing mock exam', () => {
    let chapterId: string;
    let mockId: string;
    let reader: QuestionAssociationReader;

    beforeAll(async () => {
      const chapter = await createSession({ mode: 'CHAPTER', scope: { knowledgePointId: leaf1 }, count: 50 }).expect(
        200,
      );
      chapterId = chapter.body.data.id;
      const [{ id }]: { id: string }[] = await app.get(DataSource).query(
        `INSERT INTO "practice_session" ("userId", "subjectId", "mode", "questionIds", "questionVersions", "status")
         VALUES ($1, $2, 'MOCK', $3, $4, 'IN_PROGRESS') RETURNING "id"`,
        [user.id, subjectId, [singles[2], judgeId, singles[3]], { [singles[2]]: 1, [judgeId]: 1, [singles[3]]: 1 }],
      );
      mockId = id;
      reader = app.get(QuestionAssociationReader);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should exclude questions of the ongoing mock from new sessions', async () => {
      const { body } = await createSession({ mode: 'CHAPTER', scope: { knowledgePointId: leaf1 }, count: 50 }).expect(
        200,
      );
      const ids = (body.data as SessionBody).card.map((item) => item.questionId);
      expect(ids).not.toContain(singles[2]);
      expect(ids).not.toContain(judgeId);
      await as(user).post(`/practice/sessions/${body.data.id}/abandon`).expect(200);
    });

    it('should reject answering mock questions in other sessions without revealing results', async () => {
      const { body } = await answer(chapterId, [{ questionId: singles[2], answer: { keys: ['B'] } }]).expect(409);
      expect(body.data).toMatchObject({ errorKey: 'questionInMockInProgress', questionIds: [singles[2]] });
      expect(JSON.stringify(body)).not.toMatch(/isCorrect|analysis/);

      const questions = await segment(chapterId);
      expect(questions.find((question) => question.id === singles[2])).toMatchObject({
        hiddenReason: 'mockInProgress',
        solution: null,
      });
    });

    it('should not reveal unanswered wrong book questions inside a session', async () => {
      const lookup = vi
        .spyOn(reader, 'findAssociatedQuestionIds')
        .mockImplementation((_userId, ids) =>
          Promise.resolve(ids.filter((id) => id === singles[2] || id === singles[1])),
        );
      const questions = await segment(chapterId);
      expect(questions.find((question) => question.id === singles[1])).toMatchObject({
        answerState: null,
        solution: null,
        hiddenReason: null,
      });
      expect(lookup).not.toHaveBeenCalled();
      expect(questions.find((question) => question.id === singles[2])).toMatchObject({
        solution: null,
        hiddenReason: 'mockInProgress',
      });
    });

    it('should keep mock questions in the daily set and reject answering them', async () => {
      const daily = await createSession({ mode: 'DAILY' }).expect(200);
      expect((daily.body.data as SessionBody).card.map((item) => item.questionId)).toContain(singles[3]);
      const { body } = await answer(daily.body.data.id, [{ questionId: singles[3], answer: { keys: ['B'] } }]).expect(
        409,
      );
      expect(body.data).toMatchObject({ errorKey: 'questionInMockInProgress', questionIds: [singles[3]] });
    });

    it('should reject trial checks of mock questions for the signed-in user only', async () => {
      await setDailyQuestions([singles[2], singles[0]]);
      const check = (account: Account | null) =>
        as(account).post(`/subjects/${subjectId}/daily/trial/check`, {
          date: businessDate(),
          answers: [{ questionId: singles[2], answer: { keys: ['B'] } }],
        });
      const rejected = await check(user).expect(409);
      expect(rejected.body.data).toMatchObject({ errorKey: 'questionInMockInProgress', questionIds: [singles[2]] });
      expect(JSON.stringify(rejected.body)).not.toMatch(/isCorrect/);
      await check(null)
        .expect(200)
        .expect(({ body }) => expect(body.data.results).toEqual([{ questionId: singles[2], isCorrect: true }]));
      await check(other).expect(200);
    });

    it('should return question content with the hidden reason through the single question endpoint', async () => {
      const { body } = await as(user).get(`/questions/${singles[2]}`).expect(200);
      expect(body.data).toMatchObject({ id: singles[2], hiddenReason: 'mockInProgress' });
      expect(JSON.stringify(body.data)).not.toMatch(/"answer"|"analysis"/);
    });

    it('should accept answers again after the mock is abandoned', async () => {
      await as(user).post(`/practice/sessions/${mockId}/abandon`).expect(200);
      const { body } = await answer(chapterId, [{ questionId: singles[2], answer: { keys: ['B'] } }]).expect(200);
      expect(body.data.results[0]).toMatchObject({ answerState: { isCorrect: true }, hiddenReason: null });
    });
  });

  describe('single question access', () => {
    it('should return related questions without answers', async () => {
      const { body } = await as(user).get(`/questions/${singles[1]}`).expect(200);
      expect(body.data).toMatchObject({ id: singles[1], type: 'SINGLE', hiddenReason: null, solution: null });
      expect(JSON.stringify(body.data)).not.toMatch(/"answer"|"analysis"/);

      const inWrongBook = (): Promise<{ id: string }[]> =>
        app
          .get(DataSource)
          .query(`SELECT "id" FROM "wrong_question" WHERE "userId" = $1 AND "questionId" = $2`, [user.id, singles[0]]);
      for (let attempt = 0; attempt < 150 && (await inWrongBook()).length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const wrong = await as(user).get(`/questions/${singles[0]}`).expect(200);
      expect(wrong.body.data).toMatchObject({
        id: singles[0],
        hiddenReason: null,
        solution: { answer: { keys: ['B'] } },
      });

      const material = await as(user).get(`/questions/${materialId}`).expect(200);
      expect(material.body.data.children.map((child: { id: string }) => child.id)).toEqual(subIds);
      const sub = await as(user).get(`/questions/${subIds[1]}`).expect(200);
      expect(sub.body.data).toMatchObject({ id: materialId, children: [expect.objectContaining({ id: subIds[1] })] });
    });

    it('should reject questions without any relation to the user', async () => {
      const stranger = await registerAndLogin(app);
      await as(stranger)
        .get(`/questions/${singles[0]}`)
        .expect(403)
        .expect(({ body }) => expect(body.data.errorKey).toBe('questionNotAccessible'));
      await as(user).get(`/questions/${draftId}`).expect(403);
      await as(user).get('/questions/00000000-0000-4000-8000-000000000000').expect(403);
    });
  });

  it('should abandon inactive sessions without a time limit except daily practice', async () => {
    const created = await createSession({ mode: 'RANDOM', count: 1 }).expect(200);
    const daily = await createSession({ mode: 'DAILY' }).expect(200);
    const dataSource = app.get(DataSource);
    await dataSource.query(`UPDATE "practice_session" SET "lastActiveAt" = '2000-01-01' WHERE "id" = ANY($1::uuid[])`, [
      [created.body.data.id, daily.body.data.id],
    ]);

    const abandoned = await app
      .get(PracticeSessionRepository)
      .abandonInactive(new Date('2000-01-02T00:00:00Z'), [PracticeMode.DAILY, PracticeMode.MOCK], 500);

    expect(abandoned).toBeGreaterThanOrEqual(1);
    const rows: { id: string; status: string }[] = await dataSource.query(
      `SELECT "id", "status" FROM "practice_session" WHERE "id" = ANY($1::uuid[])`,
      [[created.body.data.id, daily.body.data.id]],
    );
    expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toEqual({
      [created.body.data.id]: 'ABANDONED',
      [daily.body.data.id]: 'IN_PROGRESS',
    });
  });
});
