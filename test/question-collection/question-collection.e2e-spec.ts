// 需在独立的测试数据库与 Redis 上运行：会注册测试用户并写入考试、科目、知识点、题目、试卷、练习会话、收藏与笔记
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

process.env.THROTTLE_ENABLED = 'true';
process.env.THROTTLE_LIMIT = '1000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

type Account = { token: string; email: string; id: number };
type FavoriteItem = {
  id: number;
  targetType: string;
  targetId: string;
  title: string | null;
  image: string | null;
  subjectId: string | null;
};

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

async function registerAndLogin(app: NestExpressApplication): Promise<Account> {
  const email = `collect.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = md5('Secret00');
  await api(app)
    .post('/api/v1/auth/email/register')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password, firstName: 'Collect', lastName: 'E2E' })
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

describe('Question favorites and notes', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let admin: Account;
  let examId: string;
  const subjectIds: string[] = [];
  const accounts: Account[] = [];
  const questions: Record<string, string> = {};
  let paperId: string;
  let draftPaperId: string;
  let generatedPaperId: string;
  let materialId: string;
  const subIds: string[] = [];
  const unique = `${Date.now()}`;
  let seq = 0;

  const as = (account: Account) => {
    const withAuth = (req: request.Test): request.Test =>
      req.set('X-Forwarded-For', randomIp()).set('Authorization', `Bearer ${account.token}`);
    return {
      get: (path: string) => withAuth(api(app).get(`/api/v1${path}`)),
      post: (path: string, body?: object) => withAuth(api(app).post(`/api/v1${path}`)).send(body ?? {}),
      put: (path: string, body?: object) => withAuth(api(app).put(`/api/v1${path}`)).send(body ?? {}),
      delete: (path: string) => withAuth(api(app).delete(`/api/v1${path}`)),
    };
  };

  const newUser = async (): Promise<Account> => {
    const account = await registerAndLogin(app);
    accounts.push(account);
    return account;
  };

  const createQuestion = async (subjectId: string, pointId: string, name: string): Promise<string> => {
    const { body } = await as(admin)
      .post('/admin/questions', {
        subjectId,
        type: 'SINGLE',
        stem: `收藏${name} ${unique}`,
        options: ['A', 'B', 'C'].map((key) => ({ key, content: key })),
        answer: { keys: ['B'] },
        analysis: `收藏${name}解析`,
        knowledgePointIds: [pointId],
      })
      .expect(200);
    await as(admin).post(`/admin/questions/${body.data.id}/submit`).expect(200);
    await as(admin).post(`/admin/questions/${body.data.id}/publish`).expect(200);
    return body.data.id as string;
  };

  const createSubject = async (name: string): Promise<{ subjectId: string; pointId: string }> => {
    const subject = await as(admin).post('/admin/subjects', { examId, name }).expect(200);
    const subjectId = subject.body.data.id as string;
    subjectIds.push(subjectId);
    await as(admin).post(`/admin/subjects/${subjectId}/publish`).expect(200);
    const point = await as(admin)
      .post('/admin/knowledge-points', { subjectId, parentId: null, name: `${name}知识点` })
      .expect(200);
    return { subjectId, pointId: point.body.data.id as string };
  };

  const startSession = async (account: Account, subjectId: string): Promise<string> => {
    const { body } = await as(account)
      .post('/practice/sessions', { subjectId, mode: 'RANDOM', count: 20, deviceId: 'device-1' })
      .expect(200);
    return body.data.id as string;
  };

  const answerCorrectly = (account: Account, sessionId: string, questionId: string) =>
    as(account)
      .put(`/practice/sessions/${sessionId}/answers`, {
        deviceId: 'device-1',
        answers: [
          { questionId, answer: { keys: ['B'] }, clientSeq: (seq += 1), clientAnsweredAt: new Date().toISOString() },
        ],
      })
      .expect(200);

  const insertMock = async (account: Account, questionId: string, status: string): Promise<void> => {
    await dataSource.query(
      `INSERT INTO "practice_session" ("userId", "subjectId", "mode", "questionIds", "questionVersions", "status")
       VALUES ($1, $2, 'MOCK', $3, $4, $5)`,
      [account.id, subjectIds[0], [questionId], { [questionId]: 1 }, status],
    );
  };

  const favoriteQuestion = (account: Account, questionId: string, extra: object = {}) =>
    as(account).post('/favorites', { targetType: 'question', targetId: questionId, ...extra });

  const expectNotAccessible = ({ body }: request.Response): void => {
    expect(body.data.errorKey).toBe('questionNotAccessible');
  };

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await app.get(PermissionsService).refreshCache();
    admin = await registerAndLogin(app);
    await setRole(app, admin.email, RoleEnum.admin);

    const exam = await as(admin)
      .post('/admin/exams', { name: 'E2E 收藏笔记考试', category: 'CIVIL_SERVICE' })
      .expect(200);
    examId = exam.body.data.id;
    await as(admin).post(`/admin/exams/${examId}/publish`).expect(200);

    const first = await createSubject('行测');
    for (const name of ['甲', '乙', '丙', '丁', '戊']) {
      questions[name] = await createQuestion(first.subjectId, first.pointId, name);
    }
    const second = await createSubject('申论');
    questions['己'] = await createQuestion(second.subjectId, second.pointId, '己');
    const material = await as(admin)
      .post('/admin/questions', {
        subjectId: second.subjectId,
        type: 'MATERIAL',
        stem: `资料 ${unique}`,
        material: `材料正文 ${unique}`,
      })
      .expect(200);
    materialId = material.body.data.id;
    for (const [index, name] of ['小题一', '小题二'].entries()) {
      const { body } = await as(admin)
        .post('/admin/questions', {
          subjectId: second.subjectId,
          parentId: materialId,
          type: 'SINGLE',
          stem: `${name} ${unique}`,
          options: ['A', 'B'].map((key) => ({ key, content: key })),
          answer: { keys: ['B'] },
          analysis: `${name}解析`,
          knowledgePointIds: [second.pointId],
          sort: index,
        })
        .expect(200);
      subIds.push(body.data.id as string);
    }
    await as(admin).post(`/admin/questions/${materialId}/submit`).expect(200);
    await as(admin).post(`/admin/questions/${materialId}/publish`).expect(200);

    const paper = await as(admin)
      .post('/admin/papers', {
        subjectId: first.subjectId,
        title: `收藏试卷 ${unique}`,
        type: 'MOCK',
        durationMin: 60,
        multiScoringRule: 'PARTIAL',
      })
      .expect(200);
    paperId = paper.body.data.id;
    await as(admin)
      .put(`/admin/papers/${paperId}/questions`, {
        sections: [{ title: '单选', questionType: 'SINGLE' }],
        questions: [{ questionId: questions['甲'], sectionIndex: 0, score: 2 }],
      })
      .expect(200);
    await as(admin).post(`/admin/papers/${paperId}/publish`).expect(200);
    const draft = await as(admin)
      .post('/admin/papers', {
        subjectId: first.subjectId,
        title: `草稿试卷 ${unique}`,
        type: 'MOCK',
        durationMin: 60,
        multiScoringRule: 'PARTIAL',
      })
      .expect(200);
    draftPaperId = draft.body.data.id;
    const generated = await as(admin)
      .post('/admin/papers', {
        subjectId: first.subjectId,
        title: `生成试卷 ${unique}`,
        type: 'MOCK',
        durationMin: 60,
        multiScoringRule: 'PARTIAL',
      })
      .expect(200);
    generatedPaperId = generated.body.data.id;
  }, 180_000);

  beforeEach(() => {
    vi.spyOn(app.get(StatsEventQueue), 'publishRecord').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      const userIds = accounts.map((account) => account.id);
      if (userIds.length > 0) {
        await dataSource.query(`DELETE FROM "favorite" WHERE "userId" = ANY($1::int[])`, [userIds]);
      }
      for (const subjectId of subjectIds) {
        await deletePracticeSessions(app, [subjectId]);
        await dataSource.query(`DELETE FROM "paper" WHERE "subjectId" = $1`, [subjectId]);
        const owned = `SELECT "id" FROM "question" WHERE "subjectId" = $1`;
        await dataSource.query(`DELETE FROM "question_note" WHERE "questionId" IN (${owned})`, [subjectId]);
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

  it('should favorite an answered question with a server snapshot and reveal its answer outside sessions', async () => {
    const user = await newUser();
    const questionId = questions['甲'];
    const sessionId = await startSession(user, subjectIds[0]);
    await answerCorrectly(user, sessionId, questionId);

    const before = await as(user).get(`/questions/${questionId}`).expect(200);
    expect(before.body.data).toMatchObject({ id: questionId, solution: null, hiddenReason: null });

    const { body } = await favoriteQuestion(user, questionId, { title: '客户端标题', image: 'https://x/y.png' }).expect(
      200,
    );
    expect(body.data).toMatchObject({
      targetType: 'question',
      targetId: questionId,
      title: `收藏甲 ${unique}`,
      subjectId: subjectIds[0],
    });
    expect(body.data.image ?? null).toBeNull();
    await favoriteQuestion(user, questionId).expect(409);

    const after = await as(user).get(`/questions/${questionId}`).expect(200);
    expect(after.body.data).toMatchObject({
      id: questionId,
      hiddenReason: null,
      solution: { answer: { keys: ['B'] }, analysis: '收藏甲解析' },
    });
  });

  it('should reject favorites and notes for questions never answered or missing', async () => {
    const user = await newUser();
    await startSession(user, subjectIds[0]);
    await favoriteQuestion(user, questions['乙']).expect(403).expect(expectNotAccessible);
    await as(user)
      .put(`/questions/${questions['乙']}/note`, { content: '笔记' })
      .expect(403)
      .expect(expectNotAccessible);
    await favoriteQuestion(user, '00000000-0000-4000-8000-000000000000').expect(403).expect(expectNotAccessible);
    await favoriteQuestion(user, 'not-a-uuid').expect(403).expect(expectNotAccessible);
    await as(user)
      .put(`/questions/${questions['己']}/note`, { content: '笔记' })
      .expect(403)
      .expect(expectNotAccessible);
  });

  it('should reject favorites and notes for questions only in an ongoing or abandoned mock', async () => {
    const user = await newUser();
    const questionId = questions['丙'];
    await insertMock(user, questionId, 'IN_PROGRESS');
    await favoriteQuestion(user, questionId).expect(403).expect(expectNotAccessible);
    await as(user).put(`/questions/${questionId}/note`, { content: '模考中' }).expect(403).expect(expectNotAccessible);

    await dataSource.query(`UPDATE "practice_session" SET "status" = 'ABANDONED' WHERE "userId" = $1`, [user.id]);
    await favoriteQuestion(user, questionId).expect(403).expect(expectNotAccessible);
    await as(user).put(`/questions/${questionId}/note`, { content: '已放弃' }).expect(403).expect(expectNotAccessible);
  });

  it('should hide the answer of a favorited question while it is in an ongoing mock', async () => {
    const user = await newUser();
    const questionId = questions['丁'];
    await answerCorrectly(user, await startSession(user, subjectIds[0]), questionId);
    await favoriteQuestion(user, questionId).expect(200);

    await insertMock(user, questionId, 'IN_PROGRESS');
    const { body } = await as(user).get(`/questions/${questionId}`).expect(200);
    expect(body.data).toMatchObject({ id: questionId, solution: null, hiddenReason: 'mockInProgress' });
    expect(JSON.stringify(body.data)).not.toMatch(/"answer"|"analysis"/);
    await as(user).put(`/questions/${questionId}/note`, { content: '模考中' }).expect(403).expect(expectNotAccessible);
  });

  it('should save, list, filter and delete notes and reveal answers of noted questions', async () => {
    const user = await newUser();
    const questionId = questions['戊'];
    await answerCorrectly(user, await startSession(user, subjectIds[0]), questionId);
    await answerCorrectly(user, await startSession(user, subjectIds[1]), questions['己']);

    await as(user)
      .put(`/questions/${questionId}/note`, { content: '字'.repeat(1001) })
      .expect(422);
    await as(user).put(`/questions/${questionId}/note`, { content: '' }).expect(422);
    await as(user).put(`/questions/${questionId}/note`, { content: ' \n\t ' }).expect(422);
    const saved = await as(user)
      .put(`/questions/${questionId}/note`, { content: '字'.repeat(1000) })
      .expect(200);
    expect(saved.body.data).toMatchObject({ questionId, subjectId: subjectIds[0] });
    const updated = await as(user).put(`/questions/${questionId}/note`, { content: '记住 B' }).expect(200);
    expect(updated.body.data.content).toBe('记住 B');
    await as(user).put(`/questions/${questions['己']}/note`, { content: '申论笔记' }).expect(200);

    const all = await as(user).get('/me/question-notes').expect(200);
    expect(all.body.data.total).toBe(2);
    const bySubject = await as(user).get(`/me/question-notes?subjectId=${subjectIds[0]}`).expect(200);
    expect(bySubject.body.data.list).toEqual([
      expect.objectContaining({
        questionId,
        content: '记住 B',
        question: expect.objectContaining({ id: questionId, stem: `收藏戊 ${unique}` }),
      }),
    ]);
    expect(JSON.stringify(bySubject.body.data.list)).not.toMatch(/"answer"|"analysis"|解析/);
    const single = await as(user).get(`/me/question-notes?questionId=${questions['己']}`).expect(200);
    expect(single.body.data.list.map((item: { content: string }) => item.content)).toEqual(['申论笔记']);

    const question = await as(user).get(`/questions/${questionId}`).expect(200);
    expect(question.body.data.solution).toMatchObject({ answer: { keys: ['B'] } });

    const other = await newUser();
    expect((await as(other).get('/me/question-notes').expect(200)).body.data.total).toBe(0);
    await as(other).delete(`/questions/${questionId}/note`).expect(404);

    await as(user).delete(`/questions/${questionId}/note`).expect(200);
    await as(user).delete(`/questions/${questionId}/note`).expect(404);
    const afterDelete = await as(user).get(`/questions/${questionId}`).expect(200);
    expect(afterDelete.body.data.solution).toBeNull();
  });

  it('should filter question favorites by subject and type', async () => {
    const user = await newUser();
    await answerCorrectly(user, await startSession(user, subjectIds[0]), questions['乙']);
    await answerCorrectly(user, await startSession(user, subjectIds[1]), questions['己']);
    await favoriteQuestion(user, questions['乙']).expect(200);
    await favoriteQuestion(user, questions['己']).expect(200);
    await as(user).post('/favorites', { targetType: 'product', targetId: 'sku-1' }).expect(200);

    const list = async (query: string): Promise<FavoriteItem[]> =>
      (await as(user).get(`/favorites${query}`).expect(200)).body.data.list as FavoriteItem[];
    expect((await list(`?targetType=question&subjectId=${subjectIds[1]}`)).map((item) => item.targetId)).toEqual([
      questions['己'],
    ]);
    expect((await list(`?subjectId=${subjectIds[0]}`)).map((item) => item.targetId)).toEqual([questions['乙']]);
    expect(await list('?targetType=question')).toHaveLength(2);
    expect(await list('')).toHaveLength(3);
    await as(user).get('/favorites?subjectId=bad').expect(422);
  });

  it('should favorite visible papers with a title snapshot and reject unpublished ones', async () => {
    const user = await newUser();
    const { body } = await as(user)
      .post('/favorites', { targetType: 'paper', targetId: paperId.toUpperCase(), title: '客户端标题' })
      .expect(200);
    expect(body.data).toMatchObject({
      targetType: 'paper',
      targetId: paperId,
      title: `收藏试卷 ${unique}`,
      subjectId: subjectIds[0],
    });
    await as(user).post('/favorites', { targetType: 'paper', targetId: draftPaperId }).expect(404);
    await as(user).post('/favorites', { targetType: 'paper', targetId: 'missing' }).expect(404);
    await dataSource.query(
      `UPDATE "paper" SET "type" = 'GENERATED', "ownerUserId" = $2, "status" = 'PUBLISHED' WHERE "id" = $1`,
      [generatedPaperId, user.id],
    );
    await as(user).post('/favorites', { targetType: 'paper', targetId: generatedPaperId }).expect(404);

    const toggled = await as(user).post('/favorites/toggle', { targetType: 'paper', targetId: paperId }).expect(200);
    expect(toggled.body.data).toEqual({ isFavorited: false });
  });

  it('should keep client supplied title and image for product, article and store favorites', async () => {
    const user = await newUser();
    for (const targetType of ['product', 'article', 'store']) {
      const { body } = await as(user)
        .post('/favorites', {
          targetType,
          targetId: `${targetType}-1`,
          title: `${targetType} 标题`,
          image: 'https://x/y.png',
        })
        .expect(200);
      expect(body.data).toMatchObject({
        targetType,
        targetId: `${targetType}-1`,
        title: `${targetType} 标题`,
        image: 'https://x/y.png',
        subjectId: null,
      });
    }
    const checked = await as(user).post('/favorites/check', { targetType: 'store', targetId: 'store-1' }).expect(200);
    expect(checked.body.data.isFavorited).toBe(true);

    const off = await as(user).post('/favorites/toggle', { targetType: 'article', targetId: 'article-1' }).expect(200);
    expect(off.body.data).toEqual({ isFavorited: false });
    const on = await as(user)
      .post('/favorites/toggle', { targetType: 'article', targetId: 'article-1', title: '重新收藏' })
      .expect(200);
    expect(on.body.data).toMatchObject({ isFavorited: true, favorite: { title: '重新收藏' } });

    const { body } = await as(user).get('/favorites?targetType=product').expect(200);
    expect(body.data.list).toEqual([expect.objectContaining({ targetId: 'product-1' })]);
    await as(user).delete(`/favorites/${body.data.list[0].id}`).expect(200);
    await as(user).delete(`/favorites/${body.data.list[0].id}`).expect(404);
  });

  it('should normalize uppercase ids when checking and toggling question and paper favorites', async () => {
    const user = await newUser();
    const questionId = questions['乙'];
    await answerCorrectly(user, await startSession(user, subjectIds[0]), questionId);
    await favoriteQuestion(user, questionId.toUpperCase()).expect(200);

    const checked = await as(user)
      .post('/favorites/check', { targetType: 'question', targetId: questionId.toUpperCase() })
      .expect(200);
    expect(checked.body.data.isFavorited).toBe(true);
    const off = await as(user)
      .post('/favorites/toggle', { targetType: 'question', targetId: questionId.toUpperCase() })
      .expect(200);
    expect(off.body.data).toEqual({ isFavorited: false });

    await as(user).post('/favorites', { targetType: 'paper', targetId: paperId }).expect(200);
    const paperChecked = await as(user)
      .post('/favorites/check', { targetType: 'paper', targetId: paperId.toUpperCase() })
      .expect(200);
    expect(paperChecked.body.data.isFavorited).toBe(true);
    const paperOff = await as(user)
      .post('/favorites/toggle', { targetType: 'paper', targetId: paperId.toUpperCase() })
      .expect(200);
    expect(paperOff.body.data).toEqual({ isFavorited: false });
    expect((await as(user).get('/favorites').expect(200)).body.data.total).toBe(0);
  });

  it('should return solutions per sub question and render noted sub questions with their material', async () => {
    const user = await newUser();
    await answerCorrectly(user, await startSession(user, subjectIds[1]), subIds[0]);
    await favoriteQuestion(user, subIds[0]).expect(200);
    await as(user).put(`/questions/${subIds[0]}/note`, { content: '小题笔记' }).expect(200);

    const { body } = await as(user).get(`/questions/${materialId}`).expect(200);
    expect(body.data).toMatchObject({ id: materialId, type: 'MATERIAL', solution: null, hiddenReason: null });
    expect(body.data.children).toEqual([
      expect.objectContaining({ id: subIds[0], solution: { answer: { keys: ['B'] }, analysis: '小题一解析' } }),
      expect.objectContaining({ id: subIds[1], solution: null }),
    ]);

    const notes = await as(user).get(`/me/question-notes?questionId=${subIds[0]}`).expect(200);
    const [note] = notes.body.data.list;
    expect(note.question).toMatchObject({
      id: materialId,
      material: `材料正文 ${unique}`,
      children: [expect.objectContaining({ id: subIds[0] })],
    });
    expect(note.question.children).toHaveLength(1);
    expect(JSON.stringify(note.question)).not.toMatch(/"answer"|"analysis"|解析/);
  });

  it('should mark question and paper favorites whose target is no longer published', async () => {
    const user = await newUser();
    await answerCorrectly(user, await startSession(user, subjectIds[1]), subIds[1]);
    await favoriteQuestion(user, subIds[1]).expect(200);
    await as(user).post('/favorites', { targetType: 'paper', targetId: paperId }).expect(200);
    await as(user).post('/favorites', { targetType: 'store', targetId: 'store-offline' }).expect(200);

    const offlineOf = async (): Promise<Record<string, boolean | null>> => {
      const { body } = await as(user).get('/favorites').expect(200);
      return Object.fromEntries(
        (body.data.list as (FavoriteItem & { targetOffline: boolean | null })[]).map((item) => [
          item.targetId,
          item.targetOffline,
        ]),
      );
    };
    expect(await offlineOf()).toEqual({ [subIds[1]]: false, [paperId]: false, 'store-offline': null });

    try {
      await dataSource.query(`UPDATE "question" SET "status" = 'OFFLINE' WHERE "id" = $1`, [materialId]);
      await dataSource.query(`UPDATE "paper" SET "status" = 'OFFLINE' WHERE "id" = $1`, [paperId]);
      expect(await offlineOf()).toEqual({ [subIds[1]]: true, [paperId]: true, 'store-offline': null });
    } finally {
      await dataSource.query(`UPDATE "question" SET "status" = 'PUBLISHED' WHERE "id" = $1`, [materialId]);
      await dataSource.query(`UPDATE "paper" SET "status" = 'PUBLISHED' WHERE "id" = $1`, [paperId]);
    }
  });
});
