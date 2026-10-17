// 需在独立的测试数据库与 Redis 上运行：会注册测试用户并写入考试、科目、知识点、题目、试卷、组卷规则与每日一练题组
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { md5 } from '../utils/constants';
import { createTestApp, randomIp } from '../utils/test-app';
import { UsersService } from '../../src/core/users/users.service';
import { PermissionsService } from '../../src/core/permissions/permissions.service';
import { RoleEnum } from '../../src/common/enums/roles/roles.enum';
import { businessDate } from '../../src/modules/papers/domain/business-date';

process.env.THROTTLE_ENABLED = 'true';
process.env.THROTTLE_LIMIT = '1000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

type Account = { token: string; email: string; id: number };
type PaperBody = {
  id: string;
  status: string;
  title: string;
  totalScore: number;
  objectiveScore: number;
  questionCount: number;
  questions: { questionId: string; sectionIndex: number; questionVersion: number; score: number; sort: number }[];
};

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

async function registerAndLogin(app: NestExpressApplication): Promise<Account> {
  const email = `papers.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = md5('Secret00');
  await api(app)
    .post('/api/v1/auth/email/register')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password, firstName: 'Papers', lastName: 'E2E' })
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

describe('Paper catalog', () => {
  let app: NestExpressApplication;
  let admin: Account;
  let user: Account;
  let other: Account;
  let examId: string;
  let subjectId: string;
  let leaf: string;
  const singles: string[] = [];
  let materialId: string;
  let subQuestionIds: string[];
  let draftQuestionId: string;
  const fileIds: string[] = [];
  const unique = `${Date.now()}`;

  const as = (account: Account | null, ip = randomIp()) => {
    const withAuth = (req: request.Test): request.Test => {
      req.set('X-Forwarded-For', ip);
      return account ? req.set('Authorization', `Bearer ${account.token}`) : req;
    };
    return {
      get: (path: string) => withAuth(api(app).get(`/api/v1${path}`)),
      post: (path: string, body?: object) => withAuth(api(app).post(`/api/v1${path}`)).send(body ?? {}),
      put: (path: string, body?: object) => withAuth(api(app).put(`/api/v1${path}`)).send(body ?? {}),
      patch: (path: string, body?: object) => withAuth(api(app).patch(`/api/v1${path}`)).send(body ?? {}),
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

  const single = (stem: string, answer = 'B'): object => ({
    subjectId,
    type: 'SINGLE',
    stem: `${stem} ${unique}`,
    options: [
      { key: 'A', content: '甲' },
      { key: 'B', content: '乙' },
    ],
    answer: { keys: [answer] },
    analysis: '解析',
    knowledgePointIds: [leaf],
  });

  async function createPaper(title: string): Promise<PaperBody> {
    const { body } = await as(admin)
      .post('/admin/papers', { subjectId, title: `${title} ${unique}`, type: 'MOCK', durationMin: 60 })
      .expect(200);
    return body.data as PaperBody;
  }

  const sections = [
    { title: '单选', questionType: 'SINGLE' },
    { title: '资料分析', questionType: 'MATERIAL' },
  ];

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(PermissionsService).refreshCache();
    user = await registerAndLogin(app);
    other = await registerAndLogin(app);
    admin = await registerAndLogin(app);
    await setRole(app, admin.email, RoleEnum.admin);

    const exam = await as(admin).post('/admin/exams', { name: 'E2E 试卷考试', category: 'CIVIL_SERVICE' }).expect(200);
    examId = exam.body.data.id;
    await as(admin).post(`/admin/exams/${examId}/publish`).expect(200);
    const subject = await as(admin).post('/admin/subjects', { examId, name: '行测' }).expect(200);
    subjectId = subject.body.data.id;
    await as(admin).post(`/admin/subjects/${subjectId}/publish`).expect(200);
    const branch = await as(admin).post('/admin/knowledge-points', { subjectId, parentId: null, name: '常识' });
    const point = await as(admin)
      .post('/admin/knowledge-points', { subjectId, parentId: branch.body.data.id, name: '法律' })
      .expect(200);
    leaf = point.body.data.id;

    for (const name of ['甲', '乙', '丙', '丁']) {
      singles.push(await createQuestion(single(`单选${name}`), true));
    }
    materialId = await createQuestion(
      { subjectId, type: 'MATERIAL', stem: `资料 ${unique}`, material: `材料正文 ${unique}` },
      false,
    );
    subQuestionIds = [
      await createQuestion({ ...single('小题一'), parentId: materialId, sort: 0 }, false),
      await createQuestion(
        {
          subjectId,
          parentId: materialId,
          sort: 1,
          type: 'FILL',
          stem: `小题二 ${unique}`,
          answer: { blanks: [['北京']] },
          knowledgePointIds: [leaf],
        },
        false,
      ),
    ];
    await as(admin).post(`/admin/questions/${materialId}/submit`).expect(200);
    await as(admin).post(`/admin/questions/${materialId}/publish`).expect(200);
    draftQuestionId = await createQuestion(single('草稿题'), false);
  }, 180_000);

  afterAll(async () => {
    try {
      const dataSource = app.get(DataSource);
      if (subjectId) {
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
      if (fileIds.length > 0) {
        await dataSource.query(`DELETE FROM "file" WHERE "id" = ANY($1)`, [fileIds]);
      }
      await setRole(app, admin.email, RoleEnum.user);
    } finally {
      await app?.close();
    }
  });

  it('should require content permissions for admin endpoints', async () => {
    await as(user).get('/admin/papers').expect(403);
    await as(user).get('/admin/paper-rules').expect(403);
    await as(user).get(`/admin/subjects/${subjectId}/daily-sets?from=2026-01-01&to=2026-01-02`).expect(403);
    await as(null).get('/admin/papers').expect(401);
    await as(admin).get('/admin/papers/not-a-uuid').expect(400);
  });

  it('should compose a paper from published questions and freeze it once published', async () => {
    const paper = await createPaper('模拟卷');
    expect(paper).toMatchObject({ status: 'DRAFT', questionCount: 0, questions: [] });

    await as(admin)
      .put(`/admin/papers/${paper.id}/questions`, {
        sections,
        questions: [{ questionId: draftQuestionId, sectionIndex: 0, score: 1 }],
      })
      .expect(422)
      .expect(({ body }) => expect(body.data.questions).toBeDefined());
    await as(admin)
      .put(`/admin/papers/${paper.id}/questions`, {
        sections,
        questions: [{ questionId: subQuestionIds[0], sectionIndex: 1, score: 1 }],
      })
      .expect(422);
    await as(admin).post(`/admin/papers/${paper.id}/publish`).expect(409);

    const { body } = await as(admin)
      .put(`/admin/papers/${paper.id}/questions`, {
        sections,
        questions: [
          { questionId: singles[0], sectionIndex: 0, score: 1.5 },
          { questionId: singles[1], sectionIndex: 0, score: 1.5 },
          { questionId: materialId, sectionIndex: 1, score: 2, childScores: [2, 4.25] },
        ],
      })
      .expect(200);
    const composed = body.data as PaperBody;
    expect(composed).toMatchObject({ totalScore: 9.25, objectiveScore: 9.25, questionCount: 4 });
    expect(composed.questions.map((row) => [row.questionId, row.sectionIndex, row.score, row.sort])).toEqual([
      [singles[0], 0, 1.5, 0],
      [singles[1], 0, 1.5, 1],
      [subQuestionIds[0], 1, 2, 2],
      [subQuestionIds[1], 1, 4.25, 3],
    ]);
    expect(composed.questions.every((row) => row.questionVersion === 1)).toBe(true);

    await as(admin).post(`/admin/papers/${paper.id}/publish`).expect(200);
    await as(admin)
      .put(`/admin/papers/${paper.id}/questions`, { sections, questions: [] })
      .set('x-custom-lang', 'zh')
      .expect(409)
      .expect(({ body: response }) => expect(response.message).toContain('复制为新试卷'));
    await as(admin).patch(`/admin/papers/${paper.id}`, { multiScoringRule: 'PARTIAL' }).expect(409);
    await as(admin)
      .patch(`/admin/papers/${paper.id}`, { title: `模拟卷（改名） ${unique}`, year: 2025 })
      .expect(200)
      .expect(({ body: response }) => expect(response.data).toMatchObject({ year: 2025, status: 'PUBLISHED' }));
    await as(admin).delete(`/admin/papers/${paper.id}`).expect(409);

    const copy = await as(admin).post(`/admin/papers/${paper.id}/copy`).expect(200);
    expect(copy.body.data).toMatchObject({ status: 'DRAFT', totalScore: 9.25, questionCount: 4 });
    expect(copy.body.data.title).toContain('（副本）');
    await as(admin)
      .put(`/admin/papers/${copy.body.data.id}/questions`, {
        sections,
        questions: [{ questionId: singles[2], sectionIndex: 0, score: 3 }],
      })
      .expect(200)
      .expect(({ body: response }) => expect(response.data.totalScore).toBe(3));
    await as(admin).delete(`/admin/papers/${copy.body.data.id}`).expect(200);
    await as(admin).get(`/admin/papers/${copy.body.data.id}`).expect(404);

    const list = await as(admin).get(`/admin/papers?subjectId=${subjectId}&status=PUBLISHED`).expect(200);
    expect(list.body.data.list.map((item: { id: string }) => item.id)).toEqual([paper.id]);
  });

  it('should reject deleting a question referenced by a paper', async () => {
    const paper = await createPaper('引用检测');
    await app
      .get(DataSource)
      .query(
        `INSERT INTO "paper_question" ("paperId", "questionId", "sectionIndex", "questionVersion", "sort", "score") VALUES ($1, $2, 0, 0, 0, 1)`,
        [paper.id, draftQuestionId],
      );

    await as(admin)
      .delete(`/admin/questions/${draftQuestionId}`)
      .set('x-custom-lang', 'zh')
      .expect(409)
      .expect(({ body }) => expect(body.message).toContain('被试卷引用'));

    await as(admin).delete(`/admin/papers/${paper.id}`).expect(200);
  });

  it('should list published papers and hide generated papers of others', async () => {
    const [{ id: generatedId }]: { id: string }[] = await app.get(DataSource).query(
      `INSERT INTO "paper" ("subjectId", "title", "type", "ownerUserId", "durationMin", "status")
       VALUES ($1, $2, 'GENERATED', $3, 60, 'PUBLISHED') RETURNING "id"`,
      [subjectId, `个人试卷 ${unique}`, user.id],
    );
    const draft = await createPaper('草稿卷');

    const anonymous = await as(null).get(`/subjects/${subjectId}/papers`).expect(200);
    const titles = anonymous.body.data.list.map((item: { title: string }) => item.title);
    expect(titles).toEqual([`模拟卷（改名） ${unique}`]);
    expect(anonymous.body.data.list[0]).toMatchObject({
      type: 'MOCK',
      durationMin: 60,
      questionCount: 4,
      attemptCount: 0,
      lastScore: null,
      bestScore: null,
    });

    const owner = await as(user).get(`/subjects/${subjectId}/papers?type=GENERATED`).expect(200);
    expect(owner.body.data.list.map((item: { id: string }) => item.id)).toEqual([generatedId]);
    const stranger = await as(other).get(`/subjects/${subjectId}/papers`).expect(200);
    expect(stranger.body.data.list.map((item: { id: string }) => item.id)).not.toContain(generatedId);

    await as(user).get(`/papers/${generatedId}`).expect(200);
    await as(other).get(`/papers/${generatedId}`).expect(404);
    await as(null).get(`/papers/${generatedId}`).expect(404);
    await as(null).get(`/papers/${draft.id}`).expect(404);

    const published = anonymous.body.data.list[0].id as string;
    const detail = await as(null).get(`/papers/${published}`).expect(200);
    expect(detail.body.data.sections).toEqual([
      { title: '单选', questionType: 'SINGLE', questionCount: 2 },
      { title: '资料分析', questionType: 'MATERIAL', questionCount: 2 },
    ]);
    expect(detail.body.data).not.toHaveProperty('questions');

    await as(admin).post(`/admin/papers/${published}/offline`).expect(200);
    await as(null).get(`/papers/${published}`).expect(404);
    await as(admin).post(`/admin/papers/${published}/publish`).expect(200);
  });

  it('should manage paper rules and preview drawn papers without saving', async () => {
    await as(admin)
      .post('/admin/paper-rules', {
        subjectId,
        name: `规则 ${unique}`,
        durationMin: 60,
        items: [
          { sectionTitle: '单选', questionType: 'SINGLE', count: 1, scorePerQuestion: 1, knowledgePointIds: [examId] },
        ],
      })
      .expect(422);

    const created = await as(admin)
      .post('/admin/paper-rules', {
        subjectId,
        name: `规则 ${unique}`,
        durationMin: 60,
        items: [
          { sectionTitle: '单选', questionType: 'SINGLE', count: 3, scorePerQuestion: 1, knowledgePointIds: [leaf] },
          { sectionTitle: '资料分析', questionType: 'MATERIAL', count: 2, scorePerQuestion: 2.5 },
          { sectionTitle: '判断', questionType: 'JUDGE', count: 2, scorePerQuestion: 1 },
        ],
      })
      .expect(200);
    const ruleId = created.body.data.id as string;
    expect(created.body.data).toMatchObject({ status: 'DRAFT', multiScoringRule: 'ALL_OR_NOTHING' });

    const before = await as(admin).get(`/admin/papers?subjectId=${subjectId}`).expect(200);
    const preview = await as(admin).post(`/admin/paper-rules/${ruleId}/preview`).expect(200);
    const draft = preview.body.data;
    expect(draft.sections.map((section: { title: string }) => section.title)).toEqual(['单选', '资料分析', '判断']);
    expect(draft.questions.filter((item: { sectionIndex: number }) => item.sectionIndex === 0)).toHaveLength(3);
    expect(
      draft.questions
        .filter((item: { sectionIndex: number }) => item.sectionIndex === 1)
        .map((item: { questionId: string }) => item.questionId),
    ).toEqual(subQuestionIds);
    expect(draft).toMatchObject({
      questionCount: 5,
      totalScore: 8,
      insufficient: [{ itemIndex: 2, requested: 2, drawn: 0 }],
    });

    const after = await as(admin).get(`/admin/papers?subjectId=${subjectId}`).expect(200);
    expect(after.body.data.total).toBe(before.body.data.total);

    await as(admin)
      .patch(`/admin/paper-rules/${ruleId}`, { status: 'PUBLISHED', name: `规则（发布） ${unique}` })
      .expect(200)
      .expect(({ body }) => expect(body.data).toMatchObject({ status: 'PUBLISHED' }));
    const listed = await as(admin).get(`/admin/paper-rules?subjectId=${subjectId}`).expect(200);
    expect(listed.body.data.total).toBe(1);
    await as(admin).delete(`/admin/paper-rules/${ruleId}`).expect(200);
    await as(admin).get(`/admin/paper-rules/${ruleId}`).expect(404);
  });

  it('should generate the daily set once on first access', async () => {
    const today = businessDate();
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => as(null).get(`/subjects/${subjectId}/daily`).expect(200)),
    );
    expect(new Set(responses.map((response) => response.body.data.questionCount))).toEqual(new Set([6]));
    expect(responses[0].body.data).toMatchObject({ subjectId, date: today, completion: null });
    const rows: { count: number }[] = await app
      .get(DataSource)
      .query(`SELECT COUNT(*)::int AS "count" FROM "daily_question_set" WHERE "subjectId" = $1`, [subjectId]);
    expect(rows[0].count).toBe(1);
  });

  type TrialUnit = { id: string; type: string; children?: { id: string }[] };

  const setDailyQuestions = async (date: string, questionIds: string[]): Promise<void> => {
    await app.get(DataSource).query(
      `INSERT INTO "daily_question_set" ("subjectId", "date", "questionIds") VALUES ($1, $2, $3)
       ON CONFLICT ("subjectId", "date") DO UPDATE SET "questionIds" = EXCLUDED."questionIds"`,
      [subjectId, date, questionIds],
    );
  };

  const checkTrial = (body: object) => as(null).post(`/subjects/${subjectId}/daily/trial/check`, body);

  it('should return a leading material as a whole and grade normalized fill answers', async () => {
    const today = businessDate();
    await setDailyQuestions(today, [...subQuestionIds, ...singles]);

    const trial = await as(null).get(`/subjects/${subjectId}/daily/trial`).expect(200);
    const units = trial.body.data.questions as TrialUnit[];
    expect(trial.body.data).toMatchObject({ subjectId, date: today, questionCount: 3 });
    expect(units.map((unit) => [unit.id, unit.type])).toEqual([
      [materialId, 'MATERIAL'],
      [singles[0], 'SINGLE'],
    ]);
    expect(units[0].children?.map((child) => child.id)).toEqual(subQuestionIds);
    expect(JSON.stringify(trial.body.data)).not.toMatch(/"answer"|"analysis"/);

    const checked = await checkTrial({
      date: today,
      answers: [
        { questionId: subQuestionIds[0], answer: { keys: ['A'] } },
        { questionId: subQuestionIds[1], answer: { blanks: [' 北京 '] } },
        { questionId: singles[0], answer: { keys: ['B'] } },
      ],
    }).expect(200);
    expect(checked.body.data.results).toEqual([
      { questionId: subQuestionIds[0], isCorrect: false },
      { questionId: subQuestionIds[1], isCorrect: true },
      { questionId: singles[0], isCorrect: true },
    ]);
    expect(JSON.stringify(checked.body.data)).not.toMatch(/"answer"|keys/);

    await checkTrial({ date: today, answers: [{ questionId: singles[1], answer: { keys: ['B'] } }] }).expect(422);
  });

  it('should resolve file references in public trials and keep them raw for administrators', async () => {
    const [{ id: imageId }]: { id: string }[] = await app
      .get(DataSource)
      .query(
        `INSERT INTO "file" ("path", "visibility", "mimeType") VALUES ($1, 'PUBLIC', 'image/png') RETURNING "id"`,
        [`/api/v1/files/e2e-paper-${unique}.png`],
      );
    fileIds.push(imageId);
    const image = `![](file:${imageId})`;
    const stem = `看图 ${image} ${unique}`;
    const fileUrls = { [imageId]: expect.stringMatching(new RegExp(`/api/v1/files/e2e-paper-${unique}\\.png$`)) };
    const questionId = await createQuestion({ ...single('图片题'), stem }, true);
    try {
      const today = businessDate();
      await setDailyQuestions(today, [questionId]);

      const trial = await as(null).get(`/subjects/${subjectId}/daily/trial`).expect(200);
      const publicStem = (trial.body.data.questions as { stem: string }[])[0].stem;
      expect(publicStem).not.toContain(`file:${imageId}`);
      expect(publicStem).toMatch(new RegExp(`/api/v1/files/e2e-paper-${unique}\\.png`));

      const sets = await as(admin).get(`/admin/subjects/${subjectId}/daily-sets?from=${today}&to=${today}`).expect(200);
      expect(sets.body.data[0].questions).toEqual([{ id: questionId, parentId: null, type: 'SINGLE', stem, fileUrls }]);

      const paper = await createPaper('图片卷');
      const { body } = await as(admin)
        .put(`/admin/papers/${paper.id}/questions`, {
          sections,
          questions: [{ questionId, sectionIndex: 0, score: 1 }],
        })
        .expect(200);
      expect(body.data.questions[0]).toMatchObject({ questionId, stem, fileUrls });
    } finally {
      await as(admin).post(`/admin/questions/${questionId}/offline`).expect(200);
    }
  });

  it('should stop before a trailing material and grade only trial questions', async () => {
    const today = businessDate();
    await setDailyQuestions(today, [singles[0], singles[1], singles[2], ...subQuestionIds, singles[3]]);

    const trial = await as(null).get(`/subjects/${subjectId}/daily/trial`).expect(200);
    expect((trial.body.data.questions as TrialUnit[]).map((unit) => unit.id)).toEqual(singles.slice(0, 3));

    await checkTrial({
      date: today,
      answers: [{ questionId: subQuestionIds[1], answer: { blanks: ['北京'] } }],
    }).expect(422);
  });

  it('should grade against the set of yesterday and reject other dates', async () => {
    const yesterday = businessDate(new Date(Date.now() - 86_400_000));
    await setDailyQuestions(yesterday, [singles[3]]);

    const checked = await checkTrial({
      date: yesterday,
      answers: [{ questionId: singles[3], answer: { keys: ['B'] } }],
    }).expect(200);
    expect(checked.body.data.results).toEqual([{ questionId: singles[3], isCorrect: true }]);

    await checkTrial({ date: '2000-01-01', answers: [{ questionId: singles[3], answer: { keys: ['B'] } }] })
      .set('x-custom-lang', 'zh')
      .expect(422)
      .expect(({ body }) => expect(body.data).toEqual({ date: '只能按今天或昨天的题组判分' }));
    await checkTrial({ answers: [{ questionId: singles[3], answer: { keys: ['B'] } }] }).expect(422);
  });

  it('should rate limit trial checks by IP', async () => {
    const ip = randomIp();
    const check = () =>
      as(null, ip).post(`/subjects/${subjectId}/daily/trial/check`, {
        date: businessDate(),
        answers: [{ questionId: '00000000-0000-4000-8000-000000000000', answer: {} }],
      });
    for (let i = 0; i < 10; i += 1) {
      await check().expect(422);
    }
    await check().expect(429);
    await checkTrial({ date: businessDate(), answers: [] }).expect(422);
  });

  it('should list and regenerate daily sets for administrators', async () => {
    const today = businessDate();
    const listed = await as(admin).get(`/admin/subjects/${subjectId}/daily-sets?from=${today}&to=${today}`).expect(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).toMatchObject({ subjectId, date: today });
    expect(listed.body.data[0].questionIds).toHaveLength(6);
    expect(listed.body.data[0].questions.map((question: { id: string }) => question.id)).toEqual(
      listed.body.data[0].questionIds,
    );
    expect(listed.body.data[0].questions).toContainEqual(
      expect.objectContaining({ id: subQuestionIds[1], parentId: materialId, type: 'FILL', stem: `小题二 ${unique}` }),
    );

    const regenerated = await as(admin).post(`/admin/subjects/${subjectId}/daily-sets/${today}/regenerate`).expect(200);
    expect(regenerated.body.data).toMatchObject({ id: listed.body.data[0].id, date: today });
    expect(new Set(regenerated.body.data.questionIds)).toEqual(new Set(listed.body.data[0].questionIds));

    await as(admin).post(`/admin/subjects/${subjectId}/daily-sets/2000-01-01/regenerate`).expect(422);
    await as(admin).post(`/admin/subjects/${subjectId}/daily-sets/not-a-date/regenerate`).expect(422);
    await as(admin).get(`/admin/subjects/${subjectId}/daily-sets?from=${today}&to=2000-01-01`).expect(422);
    await as(admin).get(`/admin/subjects/${subjectId}/daily-sets?from=bad&to=${today}`).expect(422);
  });

  it('should hide daily sets of unpublished subjects', async () => {
    await as(null).get(`/subjects/${examId}/daily`).expect(404);
    await as(null).get(`/subjects/${examId}/papers`).expect(404);
  });
});
