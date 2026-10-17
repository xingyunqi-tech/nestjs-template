// 需在独立的测试数据库上运行：会注册测试用户并写入考试、科目、知识点、题目、试卷、导入任务与文件
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import ExcelJS from 'exceljs';
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
type Job = {
  id: string;
  status: string;
  total: number;
  succeeded: number;
  failed: number;
  fileId: string;
  errorReportFileId: string | null;
  failureReason: string | null;
};
type ReportRow = { sheet: string; row: number; field: string; reason: string };

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

async function registerAndLogin(app: NestExpressApplication): Promise<Account> {
  const email = `imports.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = md5('Secret00');
  await api(app)
    .post('/api/v1/auth/email/register')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password, firstName: 'Imports', lastName: 'E2E' })
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

function binaryParser(res: request.Response, callback: (error: Error | null, body: Buffer) => void): void {
  const stream = res as unknown as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
}

describe('Content import', () => {
  let app: NestExpressApplication;
  let admin: Account;
  let user: Account;
  let examId: string;
  let subjectId: string;
  const jobIds: string[] = [];
  const unique = `${Date.now()}`;
  const exam = `E2E 导入考试 ${unique}`;
  const subject = '行测';
  const at = { exam, subject };

  const as = (account: Account | null) => {
    const withAuth = (req: request.Test): request.Test => {
      req.set('X-Forwarded-For', randomIp());
      return account ? req.set('Authorization', `Bearer ${account.token}`) : req;
    };
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

  async function submit(zip: Buffer, name: string, publish: boolean): Promise<Job> {
    const { body } = await as(admin)
      .upload('/admin/imports')
      .attach('file', zip, name)
      .field('publishOnImport', String(publish))
      .expect(200);
    jobIds.push(body.data.id as string);
    expect(body.data).toMatchObject({ status: 'PENDING', publishOnImport: publish });
    return waitForJob(body.data.id as string);
  }

  async function report(id: string): Promise<ReportRow[]> {
    const response = await as(admin)
      .get(`/admin/imports/${id}/errors`)
      .buffer(true)
      .parse(binaryParser)
      .expect(200)
      .expect('Content-Type', /spreadsheetml/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    const rows: ReportRow[] = [];
    workbook.getWorksheet('errors')!.eachRow((row, index) => {
      if (index > 1) {
        const [, sheet, rowNumber, field, reason] = row.values as (string | number | undefined)[];
        rows.push({ sheet: String(sheet), row: Number(rowNumber), field: String(field ?? ''), reason: String(reason) });
      }
    });
    return rows;
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(PermissionsService).refreshCache();
    user = await registerAndLogin(app);
    admin = await registerAndLogin(app);
    await setRole(app, admin.email, RoleEnum.admin);

    const created = await as(admin).post('/admin/exams', { name: exam, category: 'CIVIL_SERVICE' }).expect(200);
    examId = created.body.data.id;
    const subjectResponse = await as(admin).post('/admin/subjects', { examId, name: subject }).expect(200);
    subjectId = subjectResponse.body.data.id;
  });

  afterAll(async () => {
    try {
      const dataSource = app.get(DataSource);
      const fileRows: { id: string; path: string }[] = await dataSource.query(
        `SELECT "id", "path" FROM "file" WHERE "id" IN (
           SELECT "fileId" FROM "import_job" WHERE "id" = ANY($1)
           UNION SELECT "errorReportFileId" FROM "import_job" WHERE "id" = ANY($1)
           UNION SELECT (regexp_matches(
             coalesce("stem", '') || coalesce("material", '') || coalesce("analysis", '') || coalesce("options"::text, ''),
             'file:([0-9a-f-]{36})', 'g'))[1]::uuid FROM "question" WHERE "subjectId" = $2
           UNION SELECT "audioFileId" FROM "question" WHERE "subjectId" = $2
         )`,
        [jobIds, subjectId ?? null],
      );
      const dedupKeys = jobIds.map((id) => `importFailed:${id}`);
      await dataSource.query(`DELETE FROM "notification" WHERE "metadata"->>'dedupKey' = ANY($1)`, [dedupKeys]);
      await dataSource.query(`DELETE FROM "admin_alert" WHERE "dedupKey" = ANY($1)`, [dedupKeys]);
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
    await as(user).get('/admin/imports').expect(403);
    await as(user).post('/admin/imports', { fileId: '00000000-0000-4000-8000-000000000000' }).expect(403);
    await as(null).get('/admin/imports').expect(401);
    await as(admin).post('/admin/imports', {}).expect(422);
    await as(admin).get('/admin/imports/00000000-0000-4000-8000-000000000000').expect(404);
  });

  let published: { singleId: string; materialId: string };
  const chart = Buffer.concat([PNG_BYTES, Buffer.from(unique)]);
  const listening = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(32), Buffer.from(unique)]);
  const single = (stem: string, overrides: object = {}): object => ({
    type: 'SINGLE',
    stem,
    optionA: '甲',
    optionB: '乙',
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
        materials: [
          { materialKey: 'm1', ...at, material: `资料一 ${unique} ![](assets/chart.png)` },
          { materialKey: 'm2', ...at, stem: `听力 ${unique}`, audio: 'listen.mp3' },
          { materialKey: 'm3', ...at, material: `资料三 ${unique}` },
        ],
        questions: [
          {
            questionKey: 'q1',
            ...at,
            ...single(`单选 ${unique}`, { answer: 'B', analysis: '旧解析', knowledgePath: '常识判断/科技常识' }),
          },
          { questionKey: 'q2', ...at, type: 'FILL', stem: `填空 ${unique}`, answer: 'a\\|b||c' },
          { questionKey: 'bad', ...at, ...single(`坏题 ${unique}`, { answer: 'C' }) },
          {
            materialKey: 'm1',
            order: 1,
            type: 'JUDGE',
            stem: '小题一',
            answer: '对',
            knowledgePath: '资料分析/图形资料',
          },
          { materialKey: 'm1', order: 2, ...single('小题二') },
          { materialKey: 'm2', order: 1, ...single('听力小题') },
          { materialKey: 'm3', order: 1, ...single('资料三小题一') },
          { materialKey: 'm3', order: 2, ...single('资料三小题二', { answer: 'Z' }) },
        ],
        papers: [
          { paperKey: 'p1', ...at, title: `导入卷 ${unique}`, type: 'MOCK', durationMin: 60 },
          { paperKey: 'p2', ...at, title: `失败卷 ${unique}`, type: 'MOCK', durationMin: 60 },
        ],
        paper_questions: [
          { paperKey: 'p1', sectionTitle: '单选', sectionType: 'SINGLE', sort: 1, questionKey: 'q1', score: 1 },
          { paperKey: 'p1', sectionTitle: '资料', sectionType: 'MATERIAL', sort: 2, materialKey: 'm1', score: 2 },
          { paperKey: 'p2', sectionTitle: '单选', sectionType: 'SINGLE', sort: 1, questionKey: 'bad', score: 1 },
        ],
      }),
      'assets/chart.png': chart,
      'assets/listen.mp3': listening,
    });
  }

  const sampleErrors: ReportRow[] = [
    { sheet: 'questions', row: 9, field: 'answer', reason: 'invalidQuestionAnswer' },
    { sheet: 'questions', row: 4, field: 'answer', reason: 'invalidQuestionAnswer' },
    { sheet: 'paper_questions', row: 4, field: 'questionKey', reason: 'importQuestionFailed' },
  ];

  async function questionCount(): Promise<number> {
    const [{ count }]: { count: number }[] = await app
      .get(DataSource)
      .query(`SELECT COUNT(*)::int AS "count" FROM "question" WHERE "subjectId" = $1`, [subjectId]);
    return count;
  }

  async function versionCount(): Promise<number> {
    const [{ count }]: { count: number }[] = await app
      .get(DataSource)
      .query(
        `SELECT COUNT(*)::int AS "count" FROM "question_version" WHERE "questionId" IN (SELECT "id" FROM "question" WHERE "subjectId" = $1)`,
        [subjectId],
      );
    return count;
  }

  it('should import an xlsx package with assets, publish it and report failed rows', async () => {
    const job = await submit(await samplePackage(), 'content.zip', true);

    expect(job).toMatchObject({ status: 'DONE', total: 10, succeeded: 7, failed: 3, skipped: 0, failureReason: null });
    await expect(report(job.id)).resolves.toEqual(sampleErrors);

    const { body } = await as(admin).get(`/admin/questions?subjectId=${subjectId}&topLevel=true&limit=50`).expect(200);
    const roots = body.data.list as {
      id: string;
      type: string;
      status: string;
      stem: string;
      material: string | null;
      audioFileId: string | null;
      audioUrl: string | null;
      fileUrls: Record<string, string>;
    }[];
    expect(roots.map((question) => question.status)).toEqual(['PUBLISHED', 'PUBLISHED', 'PUBLISHED', 'PUBLISHED']);
    expect(roots.some((question) => question.material?.includes('资料三'))).toBe(false);
    expect(await questionCount()).toBe(7);
    const material = roots.find((question) => question.material?.includes('资料一'))!;
    const [, imageId] = /!\[\]\(file:([0-9a-f-]{36})\)/.exec(material.material!)!;
    expect(material.fileUrls[imageId]).toMatch(/^http.*\/api\/v1\/files\/[^)]+\.png$/);
    const detail = await as(admin).get(`/admin/questions/${material.id}`).expect(200);
    expect(detail.body.data.children.map((child: { stem: string }) => child.stem)).toEqual(['小题一', '小题二']);
    const audioMaterial = roots.find((question) => question.stem === `听力 ${unique}`)!;
    expect(audioMaterial.audioFileId).toEqual(expect.any(String));
    expect(audioMaterial.audioUrl).toMatch(/\.mp3$/);
    const fill = roots.find((question) => question.type === 'FILL')!;
    const fillDetail = await as(admin).get(`/admin/questions/${fill.id}`).expect(200);
    expect(fillDetail.body.data.answer).toEqual({ blanks: [['a|b'], ['c']] });

    const papers = await as(admin).get(`/admin/papers?subjectId=${subjectId}`).expect(200);
    expect(papers.body.data.list).toEqual([
      expect.objectContaining({ title: `导入卷 ${unique}`, status: 'PUBLISHED', questionCount: 3, totalScore: 5 }),
    ]);

    published = { singleId: roots.find((question) => question.type === 'SINGLE')!.id, materialId: material.id };
  });

  it('should skip existing content when the same package is imported again', async () => {
    const versionsBefore = await versionCount();

    const job = await submit(await samplePackage(), 'content.zip', true);

    expect(job).toMatchObject({ status: 'DONE', total: 10, succeeded: 0, skipped: 7, failed: 3 });
    await expect(report(job.id)).resolves.toEqual(sampleErrors);
    expect(await questionCount()).toBe(7);
    expect(await versionCount()).toBe(versionsBefore);
    const papers = await as(admin).get(`/admin/papers?subjectId=${subjectId}`).expect(200);
    expect(papers.body.data.total).toBe(1);
    const assets: { count: number }[] = await app
      .get(DataSource)
      .query(
        `SELECT COUNT(*)::int AS "count" FROM "file" WHERE "sha256" = encode(sha256($1::bytea), 'hex') OR "sha256" = encode(sha256($2::bytea), 'hex')`,
        [chart, listening],
      );
    expect(assets).toEqual([{ count: 2 }]);
  });

  async function importJson(content: object, publishOnImport = false): Promise<Job> {
    const uploaded = await as(admin)
      .upload('/files/upload?purpose=import')
      .attach('file', Buffer.from(JSON.stringify(content)), 'content.json')
      .expect(201);
    const fileId = uploaded.body.data.file.id as string;
    const created = await as(admin).post('/admin/imports', { fileId, publishOnImport }).expect(200);
    jobIds.push(created.body.data.id as string);
    const job = await waitForJob(created.body.data.id as string);
    expect(job.fileId).toBe(fileId);
    return job;
  }

  it('should update published questions keeping blank cells and reject answer changes', async () => {
    const content = {
      questions: [
        { id: published.singleId, ...at, analysis: '新解析' },
        { id: published.singleId, ...at, answer: 'A' },
        { ...at, ...single(`单选 ${unique}`, { answer: 'B' }) },
      ],
    };

    const job = await importJson(content);

    expect(job).toMatchObject({ status: 'DONE', total: 3, succeeded: 1, failed: 1, skipped: 1 });
    await expect(report(job.id)).resolves.toEqual([
      { sheet: 'questions', row: 2, field: 'answer', reason: 'answerChangeNotAllowed' },
    ]);
    const versions = await as(admin).get(`/admin/questions/${published.singleId}/versions`).expect(200);
    expect(versions.body.data.map((version: { changeType: string }) => version.changeType)).toEqual([
      'EDIT',
      'PUBLISH',
    ]);
    const detail = await as(admin).get(`/admin/questions/${published.singleId}`).expect(200);
    expect(detail.body.data).toMatchObject({
      stem: `单选 ${unique}`,
      analysis: '新解析',
      answer: { keys: ['B'] },
      knowledgePointIds: [expect.any(String)],
    });

    await importJson({ questions: [content.questions[0]] });
    const again = await as(admin).get(`/admin/questions/${published.singleId}/versions`).expect(200);
    expect(again.body.data).toHaveLength(2);
  });

  it('should create a draft paper and update it by id', async () => {
    const paperRow = { paperKey: 'd1', ...at, title: `草稿卷 ${unique}`, type: 'MOCK', durationMin: 30 };
    const item = { paperKey: 'd1', sectionTitle: '单选', sectionType: 'SINGLE', questionId: published.singleId };

    const created = await importJson({ papers: [paperRow], paper_questions: [{ ...item, score: 1 }] });
    expect(created).toMatchObject({ succeeded: 1, failed: 0 });
    const list = await as(admin).get(`/admin/papers?subjectId=${subjectId}&status=DRAFT`).expect(200);
    const draft = (list.body.data.list as { id: string; title: string }[]).find(
      (paper) => paper.title === `草稿卷 ${unique}`,
    )!;

    const updated = await importJson({
      papers: [{ ...paperRow, id: draft.id, title: `草稿卷改 ${unique}` }],
      paper_questions: [{ ...item, score: 2 }],
    });

    expect(updated).toMatchObject({ succeeded: 1, failed: 0 });
    const detail = await as(admin).get(`/admin/papers/${draft.id}`).expect(200);
    expect(detail.body.data).toMatchObject({ title: `草稿卷改 ${unique}`, status: 'DRAFT', totalScore: 2 });
  });

  it('should fail the job and raise an alert for an unreadable package', async () => {
    const job = await submit(Buffer.from('PK\x03\x04 not really a zip'), 'broken.zip', false);

    expect(job).toMatchObject({ status: 'FAILED', failureReason: 'importInvalidPackage', errorReportFileId: null });
    await as(admin).get(`/admin/imports/${job.id}/errors`).expect(404);
    const alerts: { type: string }[] = await app
      .get(DataSource)
      .query(`SELECT "type" FROM "admin_alert" WHERE "dedupKey" = $1`, [`importFailed:${job.id}`]);
    expect(alerts).toEqual([{ type: 'importFailed' }]);
  });

  it('should list import jobs and reject non-import uploads', async () => {
    const { body } = await as(admin).get('/admin/imports?limit=100').expect(200);
    const listed = (body.data.list as Job[]).map((job) => job.id);
    expect(jobIds.every((id) => listed.includes(id))).toBe(true);
    await as(admin).get('/admin/imports?status=FAILED&limit=100').expect(200);

    await as(admin).upload('/admin/imports').attach('file', PNG_BYTES, 'chart.png').expect(422);
  });
});
