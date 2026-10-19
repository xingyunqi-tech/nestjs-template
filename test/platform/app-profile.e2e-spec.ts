// 需在独立的测试数据库与 Redis 上运行：会注册测试用户并写入 app.profile 配置，结束后恢复
import { NestExpressApplication } from '@nestjs/platform-express';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { md5 } from '../utils/constants';
import { createTestApp, randomIp } from '../utils/test-app';
import { UsersService } from '../../src/core/users/users.service';
import { PermissionsService } from '../../src/core/permissions/permissions.service';
import { RoleEnum } from '../../src/common/enums/roles/roles.enum';
import { AppConfigService } from '../../src/modules/config/config.service';

process.env.THROTTLE_ENABLED = 'true';
process.env.THROTTLE_LIMIT = '1000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

const PROFILE_KEY = 'app.profile';

const EMPTY_PROFILE = {
  appName: null,
  slogan: null,
  companyName: null,
  copyright: null,
  icpLicense: null,
  servicePhone: null,
  serviceHours: null,
  serviceEmail: null,
  shareTitle: null,
};

type Account = { token: string; email: string };

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

describe('App profile', () => {
  let app: NestExpressApplication;
  let user: Account;
  let admin: Account;
  let original: { value: Record<string, unknown> } | undefined;

  const registerAndLogin = async (): Promise<Account> => {
    const email = `profile.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
    const password = md5('Secret00');
    await api(app)
      .post('/api/v1/auth/email/register')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password, firstName: 'Profile', lastName: 'E2E' })
      .expect(200);
    const { body } = await api(app)
      .post('/api/v1/auth/email/login')
      .set('X-Forwarded-For', randomIp())
      .send({ email, password })
      .expect(200);
    return { token: body.data.token as string, email };
  };

  const setRole = async (email: string, role: RoleEnum): Promise<void> => {
    const usersService = app.get(UsersService);
    const found = await usersService.findByEmail(email);
    if (found) {
      await usersService.update(found.id, { role: { id: role } });
    }
  };

  const getProfile = () => api(app).get('/api/v1/app-profile').set('X-Forwarded-For', randomIp());

  const putProfile = (account: Account | null, body: object) => {
    const req = api(app).put('/api/v1/admin/app-profile').set('X-Forwarded-For', randomIp());
    return (account ? req.set('Authorization', `Bearer ${account.token}`) : req).send(body);
  };

  beforeAll(async () => {
    app = await createTestApp();
    await app.get(PermissionsService).refreshCache();
    const rows: { value: Record<string, unknown> }[] = await app
      .get(DataSource)
      .query(`SELECT "value" FROM "config" WHERE "key" = $1`, [PROFILE_KEY]);
    original = rows[0];
    user = await registerAndLogin();
    admin = await registerAndLogin();
    await setRole(admin.email, RoleEnum.admin);
    const { body } = await api(app)
      .post('/api/v1/auth/email/login')
      .set('X-Forwarded-For', randomIp())
      .send({ email: admin.email, password: md5('Secret00') })
      .expect(200);
    admin.token = body.data.token as string;
  }, 120_000);

  afterAll(async () => {
    try {
      if (original) {
        await app.get(AppConfigService).upsert(PROFILE_KEY, original.value);
      } else if (app) {
        await app.get(DataSource).query(`DELETE FROM "config" WHERE "key" = $1`, [PROFILE_KEY]);
        await app.get<Cache>(CACHE_MANAGER).set(`config:version:${PROFILE_KEY}`, `${Date.now()}`, 60_000);
      }
      if (admin) {
        await setRole(admin.email, RoleEnum.user);
      }
    } finally {
      await app?.close();
    }
  });

  it('should be readable without authentication', async () => {
    const { body } = await getProfile().expect(200);
    expect(Object.keys(body.data).sort()).toEqual(Object.keys(EMPTY_PROFILE).sort());
  });

  it('should return every field as null when the profile is not configured', async () => {
    await app.get(DataSource).query(`DELETE FROM "config" WHERE "key" = $1`, [PROFILE_KEY]);
    await app.get<Cache>(CACHE_MANAGER).set(`config:version:${PROFILE_KEY}`, `${Date.now()}`, 60_000);

    const { body } = await getProfile().expect(200);
    expect(body.data).toEqual(EMPTY_PROFILE);
  });

  it('should reject updates from guests and regular users', async () => {
    await putProfile(null, { appName: '游客' }).expect(401);
    await putProfile(user, { appName: '普通用户' }).expect(403);
  });

  it('should reject invalid fields with 422', async () => {
    const { body } = await putProfile(admin, {
      appName: 'a'.repeat(21),
      servicePhone: '400#123',
      serviceEmail: 'service@',
    }).expect(422);
    expect(Object.keys(body.data).sort()).toEqual(['appName', 'serviceEmail', 'servicePhone']);
  });

  it('should publish the saved profile immediately', async () => {
    await getProfile().expect(200);

    const { body: saved } = await putProfile(admin, {
      appName: ' 备考刷题E2E ',
      slogan: '',
      servicePhone: '400-123 4567',
      serviceEmail: 'service@example.com',
    }).expect(200);
    expect(saved.data).toEqual({
      ...EMPTY_PROFILE,
      appName: '备考刷题E2E',
      servicePhone: '400-123 4567',
      serviceEmail: 'service@example.com',
    });

    const { body } = await getProfile().expect(200);
    expect(body.data).toEqual(saved.data);
  });

  it('should not be readable through the generic config endpoint', async () => {
    await api(app).get(`/api/v1/config/${PROFILE_KEY}`).set('X-Forwarded-For', randomIp()).expect(404);
  });

  it('should reject writes through the generic config endpoint', async () => {
    const before = await getProfile().expect(200);

    const { body } = await api(app)
      .put(`/api/v1/config/${PROFILE_KEY}`)
      .set('X-Forwarded-For', randomIp())
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ value: { value: { appName: '通用接口' } } })
      .expect(422);
    expect(Object.keys(body.data)).toEqual(['key']);

    const { body: after } = await getProfile().expect(200);
    expect(after.data).toEqual(before.body.data);
  });
});
