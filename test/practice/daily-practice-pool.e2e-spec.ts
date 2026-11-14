// 需在独立的测试数据库与 Redis 上运行：以 2 个连接的连接池启动应用，写入考试、科目、题目、每日一练题组与练习会话
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
import { DailySetUsageRepository } from '../../src/modules/papers/infrastructure/persistence/daily-set-usage.repository';
import { PracticeSessionRepository } from '../../src/modules/practice/infrastructure/persistence/practice-session.repository';
import { PracticeMode } from '../../src/modules/practice/domain/practice-mode';

const POOL_SIZE = 2;
const ENTRIES_PER_USER = 4;
const REQUEST_TIMEOUT_MS = 20_000;

type Account = { token: string; email: string; id: number };

const overridden = ['DATABASE_MAX_CONNECTIONS', 'DATABASE_CONNECTION_TIMEOUT_MS', 'THROTTLE_LIMIT', 'LOG_LEVEL'];
const saved = Object.fromEntries(overridden.map((key) => [key, process.env[key]]));
process.env.DATABASE_MAX_CONNECTIONS = `${POOL_SIZE}`;
process.env.DATABASE_CONNECTION_TIMEOUT_MS = '5000';
process.env.THROTTLE_LIMIT = '1000';
process.env.LOG_LEVEL = 'error';

describe('Daily practice with a small connection pool', () => {
  let app: NestExpressApplication;
  let admin: Account;
  const users: Account[] = [];
  let examId: string;
  let subjectId: string;
  const questionIds: string[] = [];

  const api = () => request(app.getHttpServer());

  const as = (account: Account) => ({
    post: (path: string, body?: object) =>
      api()
        .post(`/api/v1${path}`)
        .set('X-Forwarded-For', randomIp())
        .set('Authorization', `Bearer ${account.token}`)
        .timeout(REQUEST_TIMEOUT_MS)
        .send(body ?? {}),
  });

  async function registerAndLogin(): Promise<Account> {
    const email = `pool.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = md5('Secret00');
    await api()
      .post('/api/v1/auth/email/register')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password, firstName: 'Pool', lastName: 'E2E' })
      .expect(200);
    const { body } = await api()
      .post('/api/v1/auth/email/login')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password })
      .expect(200);
    return { token: body.data.token as string, email, id: Number(body.data.user.id) };
  }

  async function setRole(email: string, role: RoleEnum): Promise<void> {
    const usersService = app.get(UsersService);
    const found = await usersService.findByEmail(email);
    if (found) {
      await usersService.update(found.id, { role: { id: role } });
    }
  }

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(PermissionsService).refreshCache();
    admin = await registerAndLogin();
    await setRole(admin.email, RoleEnum.admin);
    users.push(await registerAndLogin(), await registerAndLogin());

    const exam = await as(admin)
      .post('/admin/exams', { name: 'E2E 连接池考试', category: 'CIVIL_SERVICE' })
      .expect(200);
    examId = exam.body.data.id;
    await as(admin).post(`/admin/exams/${examId}/publish`).expect(200);
    const subject = await as(admin).post('/admin/subjects', { examId, name: '行测' }).expect(200);
    subjectId = subject.body.data.id;
    await as(admin).post(`/admin/subjects/${subjectId}/publish`).expect(200);
    for (const name of ['甲', '乙', '丙', '丁', '戊', '己']) {
      const { body } = await as(admin)
        .post('/admin/questions', {
          subjectId,
          type: 'SINGLE',
          stem: `连接池 ${name} ${Date.now()}`,
          options: [
            { key: 'A', content: '甲' },
            { key: 'B', content: '乙' },
          ],
          answer: { keys: ['B'] },
        })
        .expect(200);
      await as(admin).post(`/admin/questions/${body.data.id}/submit`).expect(200);
      await as(admin).post(`/admin/questions/${body.data.id}/publish`).expect(200);
      questionIds.push(body.data.id as string);
    }
    await app
      .get(DataSource)
      .query(`INSERT INTO "daily_question_set" ("subjectId", "date", "questionIds") VALUES ($1, $2, $3)`, [
        subjectId,
        businessDate(),
        questionIds,
      ]);
  }, 180_000);

  afterAll(async () => {
    try {
      const dataSource = app.get(DataSource);
      if (subjectId) {
        await deletePracticeSessions(app, [subjectId]);
        await dataSource.query(`DELETE FROM "daily_question_set" WHERE "subjectId" = $1`, [subjectId]);
        const owned = `SELECT "id" FROM "question" WHERE "subjectId" = $1`;
        await dataSource.query(`DELETE FROM "question_version" WHERE "questionId" IN (${owned})`, [subjectId]);
        await dataSource.query(`DELETE FROM "question" WHERE "subjectId" = $1`, [subjectId]);
        await dataSource.query(`DELETE FROM "subject" WHERE "id" = $1`, [subjectId]);
      }
      if (examId) {
        await dataSource.query(`DELETE FROM "exam" WHERE "id" = $1`, [examId]);
      }
      if (admin) {
        await setRole(admin.email, RoleEnum.user);
      }
    } finally {
      await app?.close();
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    }
  });

  it('should run the API on a pool of the configured size', () => {
    const driver = app.get(DataSource).driver as unknown as { master: { options: { max: number } } };
    expect(driver.master.options.max).toBe(POOL_SIZE);
  });

  it('should finish concurrent daily entries and regenerations beyond the pool size with one session per user', async () => {
    const today = businessDate();
    const entries = users.flatMap((account) =>
      Array.from({ length: ENTRIES_PER_USER }, () =>
        as(account)
          .post('/practice/sessions', { subjectId, deviceId: 'device-1', mode: 'DAILY' })
          .then((response) => ({ userId: account.id, response })),
      ),
    );
    const regenerations = Array.from({ length: 2 }, () =>
      as(admin).post(`/admin/subjects/${subjectId}/daily-sets/${today}/regenerate`),
    );

    const [entered, regenerated] = await Promise.all([Promise.all(entries), Promise.all(regenerations)]);

    expect(entered.length).toBeGreaterThan(POOL_SIZE);
    expect(entered.map(({ response }) => response.status)).toEqual(entered.map(() => 200));
    expect(regenerated.every((response) => [200, 409].includes(response.status))).toBe(true);

    const dataSource = app.get(DataSource);
    const [set]: { questionIds: string[] }[] = await dataSource.query(
      `SELECT "questionIds"::text[] AS "questionIds" FROM "daily_question_set" WHERE "subjectId" = $1 AND "date" = $2`,
      [subjectId, today],
    );
    for (const account of users) {
      const ids = new Set(
        entered.filter(({ userId }) => userId === account.id).map(({ response }) => response.body.data.id as string),
      );
      expect(ids.size).toBe(1);
      const sessions: { id: string; questionIds: string[] }[] = await dataSource.query(
        `SELECT "id", "questionIds"::text[] AS "questionIds" FROM "practice_session"
         WHERE "userId" = $1 AND "subjectId" = $2 AND "mode" = 'DAILY' AND "dailyDate" = $3`,
        [account.id, subjectId, today],
      );
      expect(sessions.map((session) => session.id)).toEqual([...ids]);
      expect(sessions[0].questionIds).toEqual(set.questionIds);
    }
  }, 60_000);

  it('should not create the daily session when the daily set differs from the drawn one', async () => {
    const today = businessDate();
    const dataSource = app.get(DataSource);
    const [{ questionIds: drawn }]: { questionIds: string[] }[] = await dataSource.query(
      `SELECT "questionIds"::text[] AS "questionIds" FROM "daily_question_set" WHERE "subjectId" = $1 AND "date" = $2`,
      [subjectId, today],
    );
    await dataSource.query(
      `UPDATE "daily_question_set" SET "questionIds" = $3 WHERE "subjectId" = $1 AND "date" = $2`,
      [subjectId, today, [...drawn].reverse()],
    );
    const key = { userId: admin.id, subjectId, dailyDate: today };

    const created = await app.get(PracticeSessionRepository).createDaily(
      key,
      {
        ...key,
        mode: PracticeMode.DAILY,
        paperId: null,
        scope: {},
        questionIds: drawn,
        questionVersions: Object.fromEntries(drawn.map((id) => [id, 1])),
        activeDeviceId: null,
        deadlineAt: null,
        autoSubmitAt: null,
        scoringScheme: null,
        totalScore: null,
      },
      drawn,
    );

    expect(created).toBeNull();
    const [{ count }]: { count: number }[] = await dataSource.query(
      `SELECT COUNT(*)::int AS "count" FROM "practice_session" WHERE "userId" = $1 AND "subjectId" = $2`,
      [admin.id, subjectId],
    );
    expect(count).toBe(0);
  });

  it('should not replace the daily set once a daily session exists', async () => {
    const today = businessDate();
    const dataSource = app.get(DataSource);
    const read = async (): Promise<string[]> =>
      (
        await dataSource.query(
          `SELECT "questionIds"::text[] AS "questionIds" FROM "daily_question_set" WHERE "subjectId" = $1 AND "date" = $2`,
          [subjectId, today],
        )
      )[0].questionIds;
    const before = await read();

    await expect(
      app.get(DailySetUsageRepository).replaceIfUnused(subjectId, today, [questionIds[0]]),
    ).resolves.toBeNull();
    expect(await read()).toEqual(before);
  });
});
