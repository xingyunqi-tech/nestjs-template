// 需在独立的测试数据库上运行：会注册测试用户并写入考试、科目、知识点、题目、试卷、导入任务与文件
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { unlink } from 'fs/promises';
import { basename, join } from 'path';
import { md5 } from '../utils/constants';
import { createTestApp, randomIp } from '../utils/test-app';
import { buildWorkbook, buildZip, PNG_BYTES } from '../utils/import-package';
import { UsersService } from '../../src/core/users/users.service';
import { PermissionsService } from '../../src/core/permissions/permissions.service';
import { RoleEnum } from '../../src/common/enums/roles/roles.enum';

process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

type Account = { token: string; email: string };
type Counts = { knowledgePoints: number; materials: number; questions: number; papers: number };
type RowError = { sheet: string; row: number; field: string; reason: string; message: string; detail?: string };
type Precheck = { wouldCreate: Counts; wouldUpdate: Counts; wouldSkip: Counts; errors: RowError[]; truncated: boolean };
type Job = { id: string; status: string; total: number; succeeded: number; failed: number; skipped: number };

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

const sum = (counts: Counts): number => counts.knowledgePoints + counts.materials + counts.questions + counts.papers;

async function registerAndLogin(app: NestExpressApplication): Promise<Account> {
  const email = `precheck.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = md5('Secret00');
  await api(app)
    .post('/api/v1/auth/email/register')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password, firstName: 'Precheck', lastName: 'E2E' })
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

describe('Import precheck and error details', () => {
  let app: NestExpressApplication;
  let admin: Account;
  let user: Account;
  let examId: string;
  let subjectId: string;
  const jobIds: string[] = [];
  const unique = `${Date.now()}`;
  const exam = `E2E 预检考试 ${unique}`;
  const at = { exam, subject: '行测' };
  const chart = Buffer.concat([PNG_BYTES, Buffer.from(`precheck ${unique}`)]);

  const as = (account: Account) => {
    const withAuth = (req: request.Test): request.Test =>
      req.set('X-Forwarded-For', randomIp()).set('Authorization', `Bearer ${account.token}`);
    return {
      get: (path: string) => withAuth(api(app).get(`/api/v1${path}`)),
      post: (path: string, body?: object) => withAuth(api(app).post(`/api/v1${path}`)).send(body ?? {}),
      upload: (path: string) => withAuth(api(app).post(`/api/v1${path}`)),
    };
  };

  async function waitForJob(id: string): Promise<Job> {
    for (let attempt = 0; attempt < 100; attempt++) {
      const { body } = await as(admin).get(`/admin/imports/${id}`).expect(200);
      const job = body.data as Job;
      if (job.status === 'DONE' || job.status === 'FAILED') {
        return job;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`Import job ${id} did not finish`);
  }

  async function precheck(zip: Buffer, publish: boolean): Promise<Precheck> {
    const { body } = await as(admin)
      .upload('/admin/imports/precheck')
      .attach('file', zip, 'content.zip')
      .field('publishOnImport', String(publish))
      .expect(200);
    return body.data as Precheck;
  }

  async function submit(zip: Buffer, publish: boolean): Promise<Job> {
    const { body } = await as(admin)
      .upload('/admin/imports')
      .attach('file', zip, 'content.zip')
      .field('publishOnImport', String(publish))
      .expect(200);
    jobIds.push(body.data.id as string);
    return waitForJob(body.data.id as string);
  }

  async function snapshot(): Promise<Record<string, number>> {
    const dataSource = app.get(DataSource);
    const count = async (sql: string, params: unknown[]): Promise<number> => {
      const [{ count: value }]: { count: number }[] = await dataSource.query(sql, params);
      return value;
    };
    return {
      questions: await count(`SELECT COUNT(*)::int AS "count" FROM "question" WHERE "subjectId" = $1`, [subjectId]),
      knowledgePoints: await count(`SELECT COUNT(*)::int AS "count" FROM "knowledge_point" WHERE "subjectId" = $1`, [
        subjectId,
      ]),
      papers: await count(`SELECT COUNT(*)::int AS "count" FROM "paper" WHERE "subjectId" = $1`, [subjectId]),
      assets: await count(
        `SELECT COUNT(*)::int AS "count" FROM "file" WHERE "sha256" = encode(sha256($1::bytea), 'hex')`,
        [chart],
      ),
      jobs: await count(
        `SELECT COUNT(*)::int AS "count" FROM "import_job" WHERE "createdBy" = (SELECT "id" FROM "user" WHERE "email" = $1)`,
        [admin.email],
      ),
    };
  }

  const single = (stem: string, overrides: object = {}): object => ({
    type: 'SINGLE',
    stem,
    options: 'A. 甲\nB. 乙',
    answer: 'A',
    ...overrides,
  });

  async function samplePackage(): Promise<Buffer> {
    return buildZip({
      'content.xlsx': await buildWorkbook({
        knowledge_points: [
          { ...at, path: '常识判断/科技常识' },
          { ...at, path: '资料分析/图形资料' },
        ],
        materials: [{ materialKey: 'm1', ...at, material: `资料 ${unique} ![](assets/chart.png)` }],
        questions: [
          { questionKey: 'q1', ...at, ...single(`单选 ${unique}`, { knowledgePath: '常识判断/科技常识' }) },
          { questionKey: 'q2', ...at, ...single(`同时填两种选项 ${unique}`, { optionA: '甲', optionB: '乙' }) },
          { questionKey: 'q3', ...at, ...single(`坏答案 ${unique}`, { answer: 'C' }) },
          { questionKey: 'q4', ...at, type: 'FILL', stem: `填空 ${unique}`, answer: '' },
          { materialKey: 'm1', order: 1, ...single('小题一', { knowledgePath: '资料分析/图形资料' }) },
          { materialKey: 'm1', order: 2, ...single('小题二') },
        ],
        papers: [
          { paperKey: 'p1', ...at, title: `预检卷 ${unique}`, type: 'MOCK', durationMin: 60 },
          { paperKey: 'p2', ...at, title: `失败卷 ${unique}`, type: 'MOCK', durationMin: 60 },
        ],
        paper_questions: [
          { paperKey: 'p1', sectionTitle: '单选', sectionType: 'SINGLE', sort: 1, questionKey: 'q1', score: 1 },
          { paperKey: 'p1', sectionTitle: '资料', sectionType: 'MATERIAL', sort: 2, materialKey: 'm1', score: 2 },
          { paperKey: 'p2', sectionTitle: '单选', sectionType: 'SINGLE', sort: 1, questionKey: 'q3', score: 1 },
        ],
      }),
      'assets/chart.png': chart,
    });
  }

  const sampleErrors = [
    { sheet: 'questions', row: 3, field: 'options', reason: 'importOptionColumnsConflict' },
    { sheet: 'questions', row: 4, field: 'answer', reason: 'invalidQuestionAnswer' },
    { sheet: 'questions', row: 5, field: 'answer', reason: 'invalidQuestionAnswer' },
    { sheet: 'paper_questions', row: 4, field: 'questionKey', reason: 'importQuestionFailed' },
  ];

  const reasons = (errors: RowError[]) =>
    errors.map(({ sheet, row, field, reason }) => ({ sheet, row, field, reason }));

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(PermissionsService).refreshCache();
    user = await registerAndLogin(app);
    admin = await registerAndLogin(app);
    await setRole(app, admin.email, RoleEnum.admin);

    const created = await as(admin).post('/admin/exams', { name: exam, category: 'CIVIL_SERVICE' }).expect(200);
    examId = created.body.data.id;
    const subjectResponse = await as(admin).post('/admin/subjects', { examId, name: at.subject }).expect(200);
    subjectId = subjectResponse.body.data.id;
  });

  afterAll(async () => {
    try {
      const dataSource = app.get(DataSource);
      const fileRows: { id: string; path: string }[] = await dataSource.query(
        `SELECT "id", "path" FROM "file" WHERE "id" IN (
           SELECT "fileId" FROM "import_job" WHERE "id" = ANY($1)
           UNION SELECT "errorReportFileId" FROM "import_job" WHERE "id" = ANY($1)
         ) OR "sha256" = encode(sha256($2::bytea), 'hex')`,
        [jobIds, chart],
      );
      await dataSource.query(`DELETE FROM "import_job" WHERE "id" = ANY($1)`, [jobIds]);
      if (subjectId) {
        const papers = `SELECT "id" FROM "paper" WHERE "subjectId" = $1`;
        await dataSource.query(`DELETE FROM "paper_question" WHERE "paperId" IN (${papers})`, [subjectId]);
        await dataSource.query(`DELETE FROM "paper" WHERE "subjectId" = $1`, [subjectId]);
        const owned = `SELECT "id" FROM "question" WHERE "subjectId" = $1`;
        await dataSource.query(`DELETE FROM "question_version" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(`DELETE FROM "question_knowledge_point" WHERE "questionId" IN (${owned})`, [subjectId]);
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
      if (fileRows.length > 0) {
        await dataSource.query(`DELETE FROM "file" WHERE "id" = ANY($1)`, [fileRows.map((file) => file.id)]);
        await Promise.all(fileRows.map((file) => unlink(join('files', basename(file.path))).catch(() => undefined)));
      }
      await setRole(app, admin.email, RoleEnum.user);
    } finally {
      await app?.close();
    }
  });

  it('should require content:manage', async () => {
    await as(user).post('/admin/imports/precheck', { fileId: '00000000-0000-4000-8000-000000000000' }).expect(403);
    await as(user).get('/admin/imports/00000000-0000-4000-8000-000000000000/errors.json').expect(403);
    await as(admin).get('/admin/imports/00000000-0000-4000-8000-000000000000/errors.json').expect(404);
  });

  let precheckResult: Precheck;

  it('should precheck a package with errors without writing anything', async () => {
    const before = await snapshot();

    precheckResult = await precheck(await samplePackage(), true);

    expect(precheckResult).toMatchObject({
      wouldCreate: { knowledgePoints: 2, materials: 1, questions: 1, papers: 1 },
      wouldUpdate: { knowledgePoints: 0, materials: 0, questions: 0, papers: 0 },
      wouldSkip: { knowledgePoints: 0, materials: 0, questions: 0, papers: 0 },
      truncated: false,
    });
    expect(reasons(precheckResult.errors)).toEqual(sampleErrors);
    expect(precheckResult.errors[0].message).toBe('optionA–optionZ 列与 options 列不能同时填写');
    expect(await snapshot()).toEqual(before);
  });

  let importedJob: Job;

  it('should match the counts and errors of the real import', async () => {
    importedJob = await submit(await samplePackage(), true);

    expect(importedJob).toMatchObject({
      status: 'DONE',
      succeeded: sum(precheckResult.wouldCreate) + sum(precheckResult.wouldUpdate),
      skipped: sum(precheckResult.wouldSkip),
      failed: 4,
    });
    const { body } = await as(admin).get(`/admin/imports/${importedJob.id}/errors.json?limit=200`).expect(200);
    expect(body.data.list).toEqual(precheckResult.errors);
    expect(body.data.total).toBe(4);
  });

  it('should page and filter the error details of a job', async () => {
    const page = await as(admin).get(`/admin/imports/${importedJob.id}/errors.json?page=2&limit=1`).expect(200);
    expect(page.body.data).toMatchObject({ total: 4, page: 2, limit: 1, totalPages: 4 });
    expect(reasons(page.body.data.list)).toEqual([sampleErrors[1]]);

    const filtered = await as(admin)
      .get(`/admin/imports/${importedJob.id}/errors.json?sheet=paper_questions`)
      .expect(200);
    expect(reasons(filtered.body.data.list)).toEqual([sampleErrors[3]]);

    await as(admin).get(`/admin/imports/${importedJob.id}/errors.json?limit=201`).expect(422);
    await as(admin).get(`/admin/imports/${importedJob.id}/errors.json?sheet=unknown`).expect(422);
  });

  it('should predict skipping everything when the package is imported again', async () => {
    const again = await precheck(await samplePackage(), true);

    expect(again.wouldCreate).toEqual({ knowledgePoints: 0, materials: 0, questions: 0, papers: 0 });
    expect(again.wouldSkip).toEqual({ knowledgePoints: 2, materials: 1, questions: 1, papers: 1 });
    expect(again.errors).toEqual(precheckResult.errors);

    const job = await submit(await samplePackage(), true);
    expect(job).toMatchObject({ succeeded: 0, skipped: sum(again.wouldSkip), failed: 4 });
  });

  it('should return an empty list for a job without errors', async () => {
    const uploaded = await as(admin)
      .upload('/files/upload?purpose=import')
      .attach('file', Buffer.from(JSON.stringify({ knowledge_points: [{ ...at, path: '常识判断' }] })), 'content.json')
      .expect(201);
    const fileId = uploaded.body.data.file.id as string;

    const checked = await as(admin).post('/admin/imports/precheck', { fileId }).expect(200);
    expect(checked.body.data).toMatchObject({ wouldSkip: { knowledgePoints: 1 }, errors: [], truncated: false });

    const created = await as(admin).post('/admin/imports', { fileId }).expect(200);
    jobIds.push(created.body.data.id as string);
    const job = await waitForJob(created.body.data.id as string);
    const { body } = await as(admin).get(`/admin/imports/${job.id}/errors.json`).expect(200);
    expect(body.data).toMatchObject({ list: [], total: 0 });
  });

  it('should reject packages with too many units with 413', async () => {
    const rows = Array.from({ length: 2001 }, (_, index) => ({ ...at, path: `路径${index}` }));

    const { body } = await as(admin)
      .upload('/admin/imports/precheck')
      .set('x-custom-lang', 'zh')
      .attach('file', Buffer.from(JSON.stringify({ knowledge_points: rows })), 'content.json')
      .expect(413);

    expect(body.message).toBe('内容过多，请直接导入后查看错误报告');
  });
});
