// 需在独立的测试数据库上运行：会注册测试用户并写入考试、科目、知识点、题目与文件记录
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { md5 } from '../utils/constants';
import { createTestApp, randomIp } from '../utils/test-app';
import { UsersService } from '../../src/core/users/users.service';
import { PermissionsService } from '../../src/core/permissions/permissions.service';
import { RoleEnum } from '../../src/common/enums/roles/roles.enum';
import { computeContentHash } from '../../src/modules/questions/domain/content-hash';
import { QuestionType } from '../../src/modules/questions/domain/question-type';

process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

type Account = { token: string; email: string };
type Node = { id: string; questionCount: number; children: Node[] };
type QuestionBody = {
  id: string;
  status: string;
  currentVersion: number;
  stem: string;
  parentId: string | null;
  knowledgePointIds: string[];
  children?: QuestionBody[];
};

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

async function registerAndLogin(app: NestExpressApplication): Promise<Account> {
  const email = `questions.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = md5('Secret00');
  await api(app)
    .post('/api/v1/auth/email/register')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password, firstName: 'Questions', lastName: 'E2E' })
    .expect(200);
  const { body } = await api(app)
    .post('/api/v1/auth/email/login')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password })
    .expect(200);
  return { token: body.data.token as string, email };
}

async function setRole(app: NestExpressApplication, email: string, role: RoleEnum): Promise<void> {
  const usersService = app.get(UsersService);
  const found = await usersService.findByEmail(email);
  if (found) {
    await usersService.update(found.id, { role: { id: role } });
  }
}

function findNode(nodes: Node[], id: string): Node | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNode(node.children, id);
    if (found) return found;
  }
  return undefined;
}

describe('Question bank', () => {
  let app: NestExpressApplication;
  let admin: Account;
  let user: Account;
  let examId: string;
  let subjectId: string;
  let branch: string;
  let leafA: string;
  let leafB: string;
  const fileIds: string[] = [];
  const unique = `${Date.now()}`;

  const as = (account: Account | null) => {
    const withAuth = (req: request.Test): request.Test => {
      req.set('X-Forwarded-For', randomIp());
      return account ? req.set('Authorization', `Bearer ${account.token}`) : req;
    };
    return {
      get: (path: string) => withAuth(api(app).get(`/api/v1${path}`)),
      post: (path: string, body?: object) => withAuth(api(app).post(`/api/v1${path}`)).send(body ?? {}),
      patch: (path: string, body?: object) => withAuth(api(app).patch(`/api/v1${path}`)).send(body ?? {}),
      delete: (path: string) => withAuth(api(app).delete(`/api/v1${path}`)),
    };
  };

  const single = (stem: string, overrides: object = {}): object => ({
    subjectId,
    type: 'SINGLE',
    stem: `${stem} ${unique}`,
    options: [
      { key: 'A', content: '甲' },
      { key: 'B', content: '乙' },
    ],
    answer: { keys: ['B'] },
    analysis: '解析',
    knowledgePointIds: [leafA],
    ...overrides,
  });

  async function createQuestion(body: object): Promise<QuestionBody> {
    const { body: response } = await as(admin).post('/admin/questions', body).expect(200);
    return response.data as QuestionBody;
  }

  async function detail(id: string): Promise<QuestionBody> {
    const { body } = await as(admin).get(`/admin/questions/${id}`).expect(200);
    return body.data as QuestionBody;
  }

  async function questionCount(id: string): Promise<number> {
    const { body } = await as(admin).get(`/admin/subjects/${subjectId}/knowledge-points`).expect(200);
    return findNode(body.data as Node[], id)!.questionCount;
  }

  async function insertFile(name: string, mimeType: string, visibility = 'PUBLIC'): Promise<string> {
    const [{ id }]: { id: string }[] = await app
      .get(DataSource)
      .query(`INSERT INTO "file" ("path", "visibility", "mimeType") VALUES ($1, $2, $3) RETURNING "id"`, [
        `/api/v1/files/${name}`,
        visibility,
        mimeType,
      ]);
    fileIds.push(id);
    return id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(PermissionsService).refreshCache();
    user = await registerAndLogin(app);
    admin = await registerAndLogin(app);
    await setRole(app, admin.email, RoleEnum.admin);

    const exam = await as(admin).post('/admin/exams', { name: 'E2E 题库考试', category: 'CIVIL_SERVICE' }).expect(200);
    examId = exam.body.data.id;
    const subject = await as(admin).post('/admin/subjects', { examId, name: '行测' }).expect(200);
    subjectId = subject.body.data.id;
    const point = async (parentId: string | null, name: string): Promise<string> => {
      const { body } = await as(admin).post('/admin/knowledge-points', { subjectId, parentId, name }).expect(200);
      return body.data.id as string;
    };
    branch = await point(null, '言语理解');
    leafA = await point(branch, '逻辑填空');
    leafB = await point(branch, '片段阅读');
  }, 120_000);

  afterAll(async () => {
    try {
      const dataSource = app.get(DataSource);
      if (subjectId) {
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
      if (fileIds.length > 0) {
        await dataSource.query(`DELETE FROM "file" WHERE "id" = ANY($1)`, [fileIds]);
      }
      await setRole(app, admin.email, RoleEnum.user);
    } finally {
      await app?.close();
    }
  });

  it('should require content permissions', async () => {
    await as(user).get('/admin/questions').expect(403);
    await as(user).post('/admin/questions/batch-publish', { ids: [] }).expect(403);
    await as(null).get('/admin/questions').expect(401);
    await as(admin).get('/admin/questions/not-a-uuid').expect(400);
  });

  it('should validate content, knowledge points and references', async () => {
    await as(admin)
      .post('/admin/questions', single('无效答案', { answer: { keys: ['C'] } }))
      .expect(422)
      .expect(({ body }) => expect(body.data.answer).toBeDefined());
    await as(admin)
      .post('/admin/questions', single('非叶子', { knowledgePointIds: [branch] }))
      .expect(422)
      .expect(({ body }) => expect(body.data.knowledgePointIds).toBeDefined());
    await as(admin)
      .post('/admin/questions', {
        subjectId,
        type: 'MATERIAL',
        stem: `缺失音频 ${unique}`,
        audioFileId: '00000000-0000-4000-8000-000000000000',
      })
      .expect(422)
      .expect(({ body }) => expect(body.data.audioFileId).toBeDefined());
    const privateImage = await insertFile(`e2e-private-${unique}.png`, 'image/png', 'PRIVATE');
    await as(admin)
      .post('/admin/questions', single('私有图片', { stem: `![](file:${privateImage}) ${unique}` }))
      .expect(422)
      .expect(({ body }) => expect(body.data.stem).toBeDefined());
  });

  it('should reject duplicate questions in the same subject', async () => {
    const first = await createQuestion(single('重复检测'));

    const { body } = await as(admin)
      .post(
        '/admin/questions',
        single('重复检测', {
          options: [
            { key: 'B', content: '乙' },
            { key: 'A', content: '甲' },
          ],
        }),
      )
      .expect(409);
    expect(body.data).toEqual({ duplicateQuestionId: first.id });
  });

  it('should version a question through review, publishing and edits', async () => {
    const question = await createQuestion(single('版本流转'));
    expect(question).toMatchObject({ status: 'DRAFT', currentVersion: 0 });

    await as(admin)
      .patch(`/admin/questions/${question.id}`, { answer: { keys: ['A'] } })
      .expect(200);
    await as(admin).post(`/admin/questions/${question.id}/submit`).expect(200);
    await as(admin).patch(`/admin/questions/${question.id}`, { stem: 'x' }).expect(409);
    await as(admin).post(`/admin/questions/${question.id}/reject`).expect(200);
    await as(admin).post(`/admin/questions/${question.id}/publish`).expect(409);
    await as(admin).post(`/admin/questions/${question.id}/submit`).expect(200);

    const published = await as(admin).post(`/admin/questions/${question.id}/publish`).expect(200);
    expect(published.body.data).toMatchObject({ status: 'PUBLISHED', currentVersion: 1 });
    expect(await questionCount(leafA)).toBe(1);

    const edited = await as(admin)
      .patch(`/admin/questions/${question.id}`, { stem: `版本流转（修订） ${unique}`, knowledgePointIds: [leafB] })
      .expect(200);
    expect(edited.body.data).toMatchObject({ currentVersion: 2, knowledgePointIds: [leafB] });
    expect([await questionCount(leafA), await questionCount(leafB)]).toEqual([0, 1]);

    const rejected = await as(admin)
      .patch(`/admin/questions/${question.id}`, { answer: { keys: ['B'] } })
      .expect(422);
    expect(rejected.body.data).toEqual({ errorKey: 'answerChangeNotAllowed' });

    const versions = await as(admin).get(`/admin/questions/${question.id}/versions`).expect(200);
    expect(versions.body.data.map((v: { version: number; changeType: string }) => [v.version, v.changeType])).toEqual([
      [2, 'EDIT'],
      [1, 'PUBLISH'],
    ]);
    expect(versions.body.data[1]).toMatchObject({ answer: { keys: ['A'] }, knowledgePointIds: [leafA] });

    await as(admin).post(`/admin/questions/${question.id}/offline`).expect(200);
    expect(await questionCount(leafB)).toBe(0);
    await as(admin).post(`/admin/questions/${question.id}/publish`).expect(200);
    expect(await questionCount(leafB)).toBe(1);
    await as(admin).delete(`/admin/questions/${question.id}`).expect(409);
  });

  it('should move materials and their sub-questions as a whole', async () => {
    const audioFileId = await insertFile(`e2e-listening-${unique}.mp3`, 'audio/mpeg');
    const material = await createQuestion({
      subjectId,
      type: 'MATERIAL',
      stem: `听力材料 ${unique}`,
      audioFileId,
      isFree: false,
    });
    const other = await createQuestion({ subjectId, type: 'MATERIAL', stem: `另一段听力 ${unique}`, material: '文本' });
    const sub = (parentId: string, stem: string): object =>
      single(stem, { parentId, stem: 'What does the man mean?', knowledgePointIds: [leafB] });
    const first = await createQuestion(sub(material.id, '1'));
    await createQuestion(sub(other.id, '1'));
    await as(admin).post('/admin/questions', sub(material.id, '1')).expect(409);
    const second = await createQuestion(single('第二小题', { parentId: material.id, knowledgePointIds: [leafB] }));
    expect(second).toMatchObject({ isFree: false });

    await as(admin).post(`/admin/questions/${first.id}/submit`).expect(409);
    await as(admin).post(`/admin/questions/${material.id}/submit`).expect(200);
    await as(admin)
      .post('/admin/questions', single('审核中加小题', { parentId: material.id }))
      .expect(409);

    const countBefore = await questionCount(leafB);
    const { body } = await as(admin)
      .post('/admin/questions/batch-publish', { ids: [second.id] })
      .expect(200);
    expect(body.data).toEqual({ count: 3 });
    expect(await questionCount(leafB)).toBe(countBefore + 2);

    const group = await detail(material.id);
    expect(group.status).toBe('PUBLISHED');
    expect(group.children?.map((child) => [child.id, child.status, child.currentVersion])).toEqual([
      [first.id, 'PUBLISHED', 1],
      [second.id, 'PUBLISHED', 1],
    ]);
    await as(admin).post(`/admin/questions/${second.id}/offline`).expect(409);
    const subVersions = await as(admin).get(`/admin/questions/${first.id}/versions`).expect(200);
    expect(subVersions.body.data).toEqual([expect.objectContaining({ version: 1, materialVersion: 1 })]);
  });

  it('should list questions with filters', async () => {
    const tagged = await createQuestion(single('列表筛选', { knowledgePointIds: [leafB], source: 'PUBLIC' }));
    const query = { subjectId, knowledgePointId: branch, source: 'PUBLIC', keyword: '列表筛选', topLevel: 'true' };

    const { body } = await as(admin).get('/admin/questions').query(query).expect(200);
    expect((body.data.list as QuestionBody[]).map((q) => q.id)).toEqual([tagged.id]);
    expect(body.data.list[0]).toHaveProperty('answer', { keys: ['B'] });

    const none = await as(admin)
      .get('/admin/questions')
      .query({ ...query, knowledgePointId: leafA })
      .expect(200);
    expect(none.body.data.total).toBe(0);
    const drafts = await as(admin)
      .get('/admin/questions')
      .query({ subjectId, status: 'DRAFT', type: 'SINGLE' })
      .expect(200);
    expect((drafts.body.data.list as QuestionBody[]).every((q) => q.status === 'DRAFT')).toBe(true);
  });

  it('should resolve file references in admin output', async () => {
    const imageId = await insertFile(`e2e-question-${unique}.png`, 'image/png');
    const question = await createQuestion(single('图片', { stem: `看图 ![](file:${imageId}) ${unique}` }));

    expect(question.stem).not.toContain(`file:${imageId}`);
    expect(question.stem).toContain(`e2e-question-${unique}.png`);
    const [stored]: { stem: string }[] = await app
      .get(DataSource)
      .query(`SELECT "stem" FROM "question" WHERE "id" = $1`, [question.id]);
    expect(stored.stem).toContain(`file:${imageId}`);
  });

  it('should roll back a material edit when a sub-question hash collides', async () => {
    const dataSource = app.get(DataSource);
    const stem = `回滚材料 ${unique}`;
    const material = await createQuestion({ subjectId, type: 'MATERIAL', stem, material: '旧资料' });
    const sub = await createQuestion(single('回滚小题', { parentId: material.id, knowledgePointIds: [] }));
    const blocker = await createQuestion(single('占位题'));
    const newMaterialHash = computeContentHash(
      { type: QuestionType.MATERIAL, stem, options: null, material: '新资料', audioFileId: null },
      null,
    );
    const collidingHash = computeContentHash(
      {
        type: QuestionType.SINGLE,
        stem: sub.stem,
        options: [
          { key: 'A', content: '甲' },
          { key: 'B', content: '乙' },
        ],
        material: null,
        audioFileId: null,
      },
      newMaterialHash,
    );
    await dataSource.query(`UPDATE "question" SET "contentHash" = $1 WHERE "id" = $2`, [collidingHash, blocker.id]);
    const hashes = async (): Promise<string[]> =>
      (
        await dataSource.query(`SELECT "contentHash" FROM "question" WHERE "id" = ANY($1) ORDER BY "id"`, [
          [material.id, sub.id],
        ])
      ).map((row: { contentHash: string }) => row.contentHash);
    const before = await hashes();

    const { body } = await as(admin).patch(`/admin/questions/${material.id}`, { material: '新资料' }).expect(409);

    expect(body.data).toEqual({ duplicateQuestionId: blocker.id });
    expect(await hashes()).toEqual(before);
    expect(await detail(material.id)).toMatchObject({ material: '旧资料' });
  });

  it('should delete only unpublished drafts', async () => {
    const draft = await createQuestion(single('删除草稿'));

    await as(admin).delete(`/admin/questions/${draft.id}`).expect(200);
    await as(admin).get(`/admin/questions/${draft.id}`).expect(404);
  });
});
