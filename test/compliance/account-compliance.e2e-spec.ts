// 需在独立的测试数据库与 Redis 上运行
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { MockInstance } from 'vitest';
import { md5 } from '../utils/constants';
import { createTestApp, randomIp } from '../utils/test-app';
import { UsersService } from '../../src/core/users/users.service';
import { PermissionsService } from '../../src/core/permissions/permissions.service';
import { RoleEnum } from '../../src/common/enums/roles/roles.enum';
import { StatsEventQueue } from '../../src/modules/study-stats/stats-event.queue';
import { StatsEventService } from '../../src/modules/study-stats/stats-event.service';
import { AppConfigService } from '../../src/modules/config/config.service';
import { AccountCleanupProducer } from '../../src/infrastructure/account-cleanup/account-cleanup.producer';
import { AccountCleanupRunner } from '../../src/modules/account-cleanup/account-cleanup.runner';
import { ConsentsService } from '../../src/modules/consents/consents.service';
import { FileStorageService } from '../../src/modules/files/file-storage.service';
import { FilePurpose } from '../../src/modules/files/domain/file-purpose';
import { FileType } from '../../src/modules/files/domain/file';
import { MOCK_SUBMIT_QUEUE } from '../../src/infrastructure/queue/mock-submit-queue/mock-submit-queue.constants';

process.env.THROTTLE_ENABLED = 'true';
process.env.THROTTLE_LIMIT = '1000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

type Account = { token: string; email: string; password: string; id: number };

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('Account compliance', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let admin: Account;
  let examId: string;
  let subjectId: string;
  let pointId: string;
  let questionId: string;
  let mockPaperId: string;
  let ruleId: string;
  let enqueueCleanup: MockInstance<AccountCleanupProducer['enqueueCleanup']>;
  const files: string[] = [];
  const users: number[] = [];
  const unique = `${Date.now()}`;
  let seq = 0;
  let versions: Record<string, string | undefined>;

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
      delete: (path: string, body?: object) => withAuth(api(app).delete(`/api/v1${path}`)).send(body ?? {}),
      upload: (path: string) => withAuth(api(app).post(`/api/v1${path}`)),
    };
  };

  const registerAndLogin = async (): Promise<Account> => {
    const email = `compliance.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = md5('Secret00');
    await api(app)
      .post('/api/v1/auth/email/register')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password, firstName: 'Compliance', lastName: 'E2E' })
      .expect(200);
    const { body } = await api(app)
      .post('/api/v1/auth/email/login')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password })
      .expect(200);
    const account = { token: body.data.token as string, email, password, id: Number(body.data.user.id) };
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

  const count = async (sql: string, params: unknown[]): Promise<number> =>
    Number((await dataSource.query(`SELECT count(*)::int AS "n" FROM ${sql}`, params))[0].n);

  const answer = async (account: Account, sessionId: string, key: string): Promise<void> => {
    await as(account)
      .put(`/practice/sessions/${sessionId}/answers`, {
        deviceId: 'device-1',
        answers: [
          { questionId, answer: { keys: [key] }, clientSeq: (seq += 1), clientAnsweredAt: new Date().toISOString() },
        ],
      })
      .expect(200);
  };

  const answerWrongAndApply = async (account: Account): Promise<void> => {
    const session = await as(account)
      .post('/practice/sessions', {
        mode: 'CHAPTER',
        subjectId,
        scope: { knowledgePointId: pointId },
        count: 10,
        deviceId: 'device-1',
      })
      .expect(200);
    const sessionId = session.body.data.id as string;
    await answer(account, sessionId, 'A');
    const [{ id: recordId }] = await dataSource.query(
      `SELECT "id" FROM "answer_record" WHERE "sessionId" = $1 AND "questionId" = $2`,
      [sessionId, questionId],
    );
    await expect(app.get(StatsEventService).applyRecord(recordId)).resolves.toBe(true);
  };

  const startMock = async (account: Account, paperId: string): Promise<string> => {
    const { body } = await as(account)
      .post('/practice/sessions', { mode: 'MOCK', subjectId, paperId, deviceId: 'device-1' })
      .expect(200);
    return body.data.id as string;
  };

  const upload = async (
    account: Account,
    purpose: string,
    fileName = 'photo.png',
  ): Promise<{ id: string; path: string; ownerUserId: number | null }> => {
    const { body } = await as(account)
      .upload(`/files/upload?purpose=${purpose}`)
      .attach('file', PNG, fileName)
      .expect(201);
    files.push(body.data.file.id as string);
    const [file] = await dataSource.query(`SELECT "id", "path", "ownerUserId" FROM "file" WHERE "id" = $1`, [
      body.data.file.id,
    ]);
    return file as { id: string; path: string; ownerUserId: number | null };
  };

  const questionStats = async () =>
    (
      await dataSource.query(`SELECT "statAnswered", "statCorrect" FROM "question" WHERE "id" = $1`, [questionId])
    )[0] as {
      statAnswered: number;
      statCorrect: number;
    };

  const attemptCount = async (paperId: string): Promise<number> =>
    (await dataSource.query(`SELECT "attemptCount" FROM "paper" WHERE "id" = $1`, [paperId]))[0].attemptCount as number;

  beforeAll(async () => {
    app = await createTestApp();
    dataSource = app.get(DataSource);
    await app.get(PermissionsService).refreshCache();
    admin = await registerAndLogin();
    await setRole(admin.email, RoleEnum.admin);

    const exam = await as(admin).post('/admin/exams', { name: 'E2E 合规考试', category: 'CIVIL_SERVICE' }).expect(200);
    examId = exam.body.data.id;
    await as(admin).post(`/admin/exams/${examId}/publish`).expect(200);
    const subject = await as(admin).post('/admin/subjects', { examId, name: '行测' }).expect(200);
    subjectId = subject.body.data.id;
    await as(admin).post(`/admin/subjects/${subjectId}/publish`).expect(200);
    pointId = (
      await as(admin)
        .post('/admin/knowledge-points', { subjectId, parentId: null, name: `常识${unique}` })
        .expect(200)
    ).body.data.id;
    const question = await as(admin)
      .post('/admin/questions', {
        subjectId,
        type: 'SINGLE',
        stem: `合规题 ${unique}`,
        options: ['A', 'B', 'C'].map((key) => ({ key, content: key })),
        answer: { keys: ['B'] },
        analysis: '合规题解析',
        knowledgePointIds: [pointId],
      })
      .expect(200);
    questionId = question.body.data.id;
    await as(admin).post(`/admin/questions/${questionId}/submit`).expect(200);
    await as(admin).post(`/admin/questions/${questionId}/publish`).expect(200);

    const paper = await as(admin)
      .post('/admin/papers', { subjectId, title: `合规模考 ${unique}`, type: 'MOCK', durationMin: 60 })
      .expect(200);
    mockPaperId = paper.body.data.id;
    await as(admin)
      .put(`/admin/papers/${mockPaperId}/questions`, {
        sections: [{ title: '题目', questionType: 'SINGLE' }],
        questions: [{ questionId, sectionIndex: 0, score: 2 }],
      })
      .expect(200);
    await as(admin).post(`/admin/papers/${mockPaperId}/publish`).expect(200);

    const rule = await as(admin)
      .post('/admin/paper-rules', {
        subjectId,
        name: `合规组卷 ${unique}`,
        durationMin: 30,
        items: [{ sectionTitle: '单选', questionType: 'SINGLE', count: 1, scorePerQuestion: 3 }],
      })
      .expect(200);
    ruleId = rule.body.data.id;
    await as(admin).patch(`/admin/paper-rules/${ruleId}`, { status: 'PUBLISHED' }).expect(200);
  }, 120_000);

  beforeEach(() => {
    versions = {
      'consent.privacyPolicyVersion': 'privacy-v1',
      'consent.userAgreementVersion': 'agreement-v1',
      'consent.aiServiceVersion': 'ai-v1',
    };
    const config = app.get(AppConfigService);
    const getValue = config.getValue.bind(config);
    vi.spyOn(config, 'getValue').mockImplementation((key) =>
      key in versions ? Promise.resolve(versions[key] as never) : getValue(key),
    );
    vi.spyOn(app.get(StatsEventQueue), 'publishRecord').mockResolvedValue(undefined);
    vi.spyOn(app.get(StatsEventQueue), 'publishSession').mockResolvedValue(undefined);
    vi.spyOn(app.get(StatsEventQueue), 'publishCheckIn').mockResolvedValue(undefined);
    enqueueCleanup = vi.spyOn(app.get(AccountCleanupProducer), 'enqueueCleanup').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    try {
      const storage = app.get(FileStorageService);
      for (const id of files) {
        const [row] = await dataSource.query(`SELECT "id", "path" FROM "file" WHERE "id" = $1`, [id]);
        if (row) {
          await dataSource.query(`UPDATE "user" SET "photoId" = NULL WHERE "photoId" = $1`, [id]);
          await storage.remove(Object.assign(new FileType(), row));
        }
      }
      if (users.length > 0) {
        await dataSource.query(`DELETE FROM "account_cleanup" WHERE "userId" = ANY($1::int[])`, [users]);
        await dataSource.query(`DELETE FROM "address" WHERE "userId" = ANY($1::int[])`, [users]);
        await dataSource.query(`DELETE FROM "user_consent" WHERE "userId" = ANY($1::int[])`, [users]);
        await dataSource.query(`DELETE FROM "notification" WHERE "userId" = ANY($1::int[])`, [users]);
        await dataSource.query(`DELETE FROM "feedback" WHERE "userId" = ANY($1::int[])`, [users]);
        await dataSource.query(`DELETE FROM "study_checkin" WHERE "userId" = ANY($1::int[])`, [users]);
        await dataSource.query(`DELETE FROM "share" WHERE "userId" = ANY($1::int[])`, [users]);
        await dataSource.query(`DELETE FROM "favorite" WHERE "userId" = ANY($1::int[])`, [users]);
      }
      if (subjectId) {
        const owned = `SELECT "id" FROM "question" WHERE "subjectId" = $1`;
        await dataSource.query(`DELETE FROM "feedback" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(`DELETE FROM "practice_session" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "paper" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "paper_rule" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "user_daily_stat" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "question_note" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "wrong_question" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(
          `DELETE FROM "user_knowledge_stat" WHERE "knowledgePointId" IN
             (SELECT "id" FROM "knowledge_point" WHERE "subjectId" = $1)`,
          [subjectId],
        );
        await dataSource.query(`DELETE FROM "question_version" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(`DELETE FROM "question" WHERE "subjectId" = $1`, [subjectId]);
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

  describe('consents', () => {
    it('should report the current versions and record a consent of the current version', async () => {
      const user = await registerAndLogin();
      await as(null).get('/me/consents').expect(401);

      const initial = await as(user).get('/me/consents').expect(200);
      expect(initial.body.data).toEqual([
        expect.objectContaining({
          type: 'PRIVACY_POLICY',
          currentVersion: 'privacy-v1',
          agreedVersion: null,
          needsConsent: true,
        }),
        expect.objectContaining({
          type: 'USER_AGREEMENT',
          currentVersion: 'agreement-v1',
          agreed: false,
          needsConsent: true,
        }),
        expect.objectContaining({ type: 'AI_SERVICE', currentVersion: 'ai-v1', agreed: false, needsConsent: true }),
      ]);

      await as(user)
        .post('/me/consents', { type: 'PRIVACY_POLICY', version: 'privacy-v0' })
        .expect(422)
        .expect(({ body }) => expect(body.data).toHaveProperty('version'));
      await as(user).post('/me/consents', { type: 'UNKNOWN', version: 'privacy-v1' }).expect(422);

      const agreed = await as(user).post('/me/consents', { type: 'PRIVACY_POLICY', version: 'privacy-v1' }).expect(200);
      expect(agreed.body.data).toMatchObject({ agreedVersion: 'privacy-v1', agreed: true, needsConsent: false });
      await as(user).post('/me/consents', { type: 'PRIVACY_POLICY', version: 'privacy-v1' }).expect(200);
      const rows = await dataSource.query(`SELECT "version", "ip" FROM "user_consent" WHERE "userId" = $1`, [user.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].ip).toEqual(expect.any(String));

      const after = await as(user).get('/me/consents').expect(200);
      expect(after.body.data[0]).toMatchObject({ type: 'PRIVACY_POLICY', agreed: true, needsConsent: false });
    });

    it('should require a new consent after the version is upgraded', async () => {
      const user = await registerAndLogin();
      await as(user).post('/me/consents', { type: 'PRIVACY_POLICY', version: 'privacy-v1' }).expect(200);

      versions['consent.privacyPolicyVersion'] = 'privacy-v2';
      const upgraded = await as(user).get('/me/consents').expect(200);
      expect(upgraded.body.data[0]).toMatchObject({
        currentVersion: 'privacy-v2',
        agreedVersion: 'privacy-v1',
        agreed: false,
        needsConsent: true,
      });

      await as(user).post('/me/consents', { type: 'PRIVACY_POLICY', version: 'privacy-v2' }).expect(200);
      expect(await count(`"user_consent" WHERE "userId" = $1 AND "type" = 'PRIVACY_POLICY'`, [user.id])).toBe(2);
    });

    it('should tell whether the current AI service statement is agreed', async () => {
      const user = await registerAndLogin();
      const consents = app.get(ConsentsService);
      await expect(consents.hasAgreedAiService(user.id)).resolves.toBe(false);

      await as(user).post('/me/consents', { type: 'AI_SERVICE', version: 'ai-v1' }).expect(200);
      await expect(consents.hasAgreedAiService(user.id)).resolves.toBe(true);

      versions['consent.aiServiceVersion'] = 'ai-v2';
      await expect(consents.hasAgreedAiService(user.id)).resolves.toBe(false);
    });
  });

  describe('account cleanup', () => {
    it('should clean the learning data of a deleted account and keep aggregates, reports and consents', async () => {
      const user = await registerAndLogin();
      const other = await registerAndLogin();

      await answerWrongAndApply(user);
      await answerWrongAndApply(other);
      await dataSource.query(
        `INSERT INTO "study_checkin" ("userId", "date", "reason") VALUES ($1, CURRENT_DATE, 'DAILY_DONE')`,
        [user.id],
      );
      await as(user).put(`/me/exam-profiles/${examId}`, {}).expect(200);
      await as(other).put(`/me/exam-profiles/${examId}`, {}).expect(200);
      await as(user).put(`/questions/${questionId}/note`, { content: '我的笔记' }).expect(200);
      await as(user).post('/favorites', { targetType: 'question', targetId: questionId }).expect(200);
      await as(user)
        .post('/shares', {
          targetType: 'PAGE',
          targetId: questionId,
          platform: 'WECHAT',
          title: '分享题目',
          url: 'https://example.com/questions/1',
        })
        .expect(200);
      const avatar = await upload(user, 'image');
      await as(user)
        .put('/auth/me', { photo: { id: avatar.id } })
        .expect(200);
      const photo = await upload(user, 'private-image');
      const referenced = await upload(user, 'image');
      await as(other)
        .put('/auth/me', { photo: { id: referenced.id } })
        .expect(200);
      const otherFile = await upload(other, 'private-image');
      await dataSource.query(
        `INSERT INTO "notification" ("userId", "type", "category", "title", "content") VALUES ($1, 'INFO', 'SYSTEM', 't', 'c')`,
        [user.id],
      );
      await dataSource.query(
        `INSERT INTO "address" ("userId", "name", "phone", "province", "city", "district", "address")
         VALUES ($1, '张三', '13800000000', '省', '市', '区', '路')`,
        [user.id],
      );
      const report = await as(user)
        .post(`/questions/${questionId}/reports`, {
          reason: 'answer_wrong',
          content: '答案应为 A',
          contact: '13800000000',
          images: ['https://example.com/report.png'],
        })
        .expect(200);
      await as(user).post('/me/consents', { type: 'PRIVACY_POLICY', version: 'privacy-v1' }).expect(200);

      const finishedMock = await startMock(user, mockPaperId);
      await answer(user, finishedMock, 'B');
      await as(user).post(`/practice/sessions/${finishedMock}/submit`).expect(200);

      const generated = await as(user).post(`/paper-rules/${ruleId}/generate`).expect(200);
      const generatedId = generated.body.data.paperId as string;
      const mockSession = await startMock(user, generatedId);
      const mockQueue = app.get<Queue>(getQueueToken(MOCK_SUBMIT_QUEUE), { strict: false });
      expect(await mockQueue.getJob(mockSession)).toBeDefined();

      const statsBefore = await questionStats();
      const attemptsBefore = await attemptCount(mockPaperId);
      expect(attemptsBefore).toBeGreaterThan(0);

      await as(user).delete('/auth/me', { oldPassword: user.password }).expect(200);
      expect(enqueueCleanup).toHaveBeenCalledWith(user.id);
      await as(user).get('/auth/me').expect(401);

      const runner = app.get(AccountCleanupRunner);
      await runner.run(user.id);

      expect(await count(`"practice_session" WHERE "userId" = $1`, [user.id])).toBe(0);
      expect(await count(`"answer_record" WHERE "userId" = $1`, [user.id])).toBe(0);
      expect(await mockQueue.getJob(mockSession)).toBeUndefined();
      expect(await count(`"paper" WHERE "id" = $1`, [generatedId])).toBe(0);
      expect(await count(`"wrong_question" WHERE "userId" = $1`, [user.id])).toBe(0);
      expect(await count(`"user_knowledge_stat" WHERE "userId" = $1`, [user.id])).toBe(0);
      expect(await count(`"user_daily_stat" WHERE "userId" = $1`, [user.id])).toBe(0);
      expect(await count(`"study_checkin" WHERE "userId" = $1`, [user.id])).toBe(0);
      expect(await count(`"user_exam_profile" WHERE "userId" = $1`, [user.id])).toBe(0);
      expect(await count(`"question_note" WHERE "userId" = $1`, [user.id])).toBe(0);
      expect(await count(`"favorite" WHERE "userId" = $1`, [user.id])).toBe(0);
      expect(await count(`"share" WHERE "userId" = $1`, [user.id])).toBe(0);
      expect(await count(`"file" WHERE "id" = ANY($1::uuid[])`, [[avatar.id, photo.id]])).toBe(0);
      expect(await count(`"file" WHERE "id" = $1`, [referenced.id])).toBe(1);
      expect(await count(`"notification" WHERE "userId" = $1`, [user.id])).toBe(0);
      expect(await count(`"notification_setting" WHERE "userId" = $1`, [other.id])).toBeGreaterThan(0);
      expect(await count(`"notification_setting" WHERE "userId" = $1`, [user.id])).toBe(0);
      expect(await count(`"address" WHERE "userId" = $1`, [user.id])).toBe(0);
      expect(await count(`"account_cleanup" WHERE "userId" = $1`, [user.id])).toBe(1);
      expect(await count(`"user" WHERE "id" = $1 AND "photoId" IS NOT NULL`, [user.id])).toBe(0);

      const [feedback] = await dataSource.query(
        `SELECT "userId", "contact", "images", "content", "questionId" FROM "feedback" WHERE "id" = $1`,
        [report.body.data.id],
      );
      expect(feedback).toEqual({ userId: null, contact: null, images: null, content: '答案应为 A', questionId });
      expect(await count(`"user_consent" WHERE "userId" = $1`, [user.id])).toBe(1);

      expect(await questionStats()).toEqual(statsBefore);
      expect(await attemptCount(mockPaperId)).toBe(attemptsBefore);

      expect(await count(`"practice_session" WHERE "userId" = $1`, [other.id])).toBe(1);
      expect(await count(`"wrong_question" WHERE "userId" = $1`, [other.id])).toBe(1);
      expect(await count(`"user_knowledge_stat" WHERE "userId" = $1`, [other.id])).toBeGreaterThan(0);
      expect(await count(`"user_exam_profile" WHERE "userId" = $1`, [other.id])).toBe(1);
      expect(await count(`"file" WHERE "id" = $1`, [otherFile.id])).toBe(1);

      await expect(runner.run(user.id)).resolves.toBeUndefined();
      expect(await count(`"user_consent" WHERE "userId" = $1`, [user.id])).toBe(1);
    });

    it('should keep content assets uploaded by a deleted content manager', async () => {
      const manager = await registerAndLogin();
      await setRole(manager.email, RoleEnum.admin);
      const image = await upload(manager, 'content-image');
      const audio = await upload(manager, 'audio', 'listen.mp3');
      expect(image.ownerUserId).toBeNull();
      const question = await as(manager)
        .post('/admin/questions', {
          subjectId,
          type: 'SINGLE',
          stem: `素材题 ${unique} ![](file:${image.id})`,
          options: ['A', 'B'].map((key) => ({ key, content: key })),
          answer: { keys: ['A'] },
          knowledgePointIds: [pointId],
        })
        .expect(200);
      expect(question.body.data.id).toEqual(expect.any(String));

      await as(manager).delete('/auth/me', { oldPassword: manager.password }).expect(200);
      await app.get(AccountCleanupRunner).run(manager.id);

      expect(await count(`"file" WHERE "id" = $1 AND "ownerUserId" IS NULL`, [image.id])).toBe(1);
      expect(audio.ownerUserId).toBeNull();
      expect(await count(`"file" WHERE "id" = $1`, [audio.id])).toBe(1);
    });

    it('should not reuse a public image uploaded by a user for imported content', async () => {
      const user = await registerAndLogin();
      const content = Buffer.concat([PNG, Buffer.from(`${unique}-${Math.random()}`)]);
      const { body } = await as(user)
        .upload('/files/upload?purpose=image')
        .attach('file', content, 'mine.png')
        .expect(201);
      files.push(body.data.file.id as string);

      const storage = app.get(FileStorageService);
      const first = await storage.storeDeduplicated(content, 'asset.png', FilePurpose.IMAGE, null);
      files.push(first.file.id);
      expect(first.reused).toBe(false);
      expect(first.file.id).not.toBe(body.data.file.id);
      const second = await storage.storeDeduplicated(content, 'asset.png', FilePurpose.IMAGE, null);
      expect(second).toMatchObject({ reused: true, file: { id: first.file.id } });
    });

    it('should route an admin deletion through the account deletion path', async () => {
      const user = await registerAndLogin();

      await as(admin).delete(`/users/${user.id}`).expect(200);

      expect(enqueueCleanup).toHaveBeenCalledWith(user.id);
      await as(user).get('/auth/me').expect(401);
      expect(await count(`"session" WHERE "userId" = $1 AND "deletedAt" IS NULL`, [user.id])).toBe(0);
    });

    it('should let an admin retrigger the cleanup of a deleted user only', async () => {
      const user = await registerAndLogin();
      const active = await registerAndLogin();
      await as(user).delete('/auth/me', { oldPassword: user.password }).expect(200);
      enqueueCleanup.mockClear();

      await as(active).post(`/admin/users/${user.id}/cleanup`).expect(403);
      await as(admin).post(`/admin/users/${user.id}/cleanup`).expect(200);
      await as(admin).post(`/admin/users/${user.id}/cleanup`).expect(200);
      expect(enqueueCleanup).toHaveBeenCalledTimes(2);
      expect(enqueueCleanup).toHaveBeenCalledWith(user.id);

      await as(admin)
        .post(`/admin/users/${active.id}/cleanup`)
        .expect(422)
        .expect(({ body }) => expect(body.data).toHaveProperty('user'));
      await as(admin).post('/admin/users/2147483000/cleanup').expect(404);
      expect(enqueueCleanup).toHaveBeenCalledTimes(2);
    });

    it('should not enqueue twice while a cleanup job of the user is pending', async () => {
      enqueueCleanup.mockRestore();
      const queue = app.get<Queue>(getQueueToken('account-cleanup'), { strict: false });
      const userId = 2147483000 - Math.floor(Math.random() * 1000);
      const jobId = `user-${userId}`;
      await queue.add('clean-account', { userId }, { jobId, delay: 3_600_000 });
      try {
        await app.get(AccountCleanupProducer).enqueueCleanup(userId);
        const jobs = await queue.getJobs(['waiting', 'delayed', 'active']);
        expect(jobs.filter((job) => job.data.userId === userId)).toHaveLength(1);
        expect(await (await queue.getJob(jobId))?.getState()).toBe('delayed');
      } finally {
        await queue.remove(jobId);
      }
    });
  });
});
