// 需在独立的测试数据库与 Redis 上运行：会注册测试用户、上传文件并写入告警
import { Controller, Get, Request, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { OptionalJwtAuthGuard } from '../../src/common/guards/optional-jwt-auth.guard';
import { PermissionsGuard } from '../../src/core/permissions/permissions.guard';
import { RequirePermissions } from '../../src/core/permissions/permissions.decorator';
import { Permission } from '../../src/core/permissions/permission.enum';
import { PermissionsService } from '../../src/core/permissions/permissions.service';
import { AlertService } from '../../src/modules/monitor/alert.service';
import { AlertLevel } from '../../src/modules/monitor/domain/admin-alert';
import { md5 } from '../utils/constants';
import { UsersService } from '../../src/core/users/users.service';
import { RoleEnum } from '../../src/common/enums/roles/roles.enum';
import { createTestApp, randomIp } from '../utils/test-app';
import { BusinessException } from '../../src/common/exceptions/business.exception';

process.env.THROTTLE_ENABLED = 'true';
process.env.THROTTLE_LIMIT = '1000';
process.env.LOG_LEVEL = 'error';
process.env.LOG_PRETTY_PRINT = 'false';

const PROBE_LIMIT = 3;

@Controller({ path: 'e2e-probe', version: '1' })
class ProbeController {
  @Get('whoami')
  @UseGuards(OptionalJwtAuthGuard)
  @Throttle({ default: { limit: PROBE_LIMIT, ttl: 60_000 } })
  whoami(@Request() req: { user?: { id: number } }): { userId: number | null } {
    return { userId: req.user?.id ?? null };
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: PROBE_LIMIT, ttl: 60_000 } })
  me(@Request() req: { user: { id: number } }): { userId: number } {
    return { userId: req.user.id };
  }

  @Get('practice')
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @RequirePermissions(Permission.PRACTICE_WRITE)
  practice(): { ok: boolean } {
    return { ok: true };
  }

  @Get('taken-over')
  takenOver(): never {
    throw new BusinessException('sessionTakenOver');
  }

  @Get('content')
  @UseGuards(AuthGuard('jwt'), PermissionsGuard)
  @RequirePermissions(Permission.CONTENT_MANAGE)
  content(): { ok: boolean } {
    return { ok: true };
  }
}

const api = (app: NestExpressApplication): ReturnType<typeof request> => request(app.getHttpServer());

type Account = { token: string; id: number };

async function register(app: NestExpressApplication): Promise<{ email: string; password: string }> {
  const email = `platform.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = md5('Secret00');
  await api(app)
    .post('/api/v1/auth/email/register')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password, firstName: 'Platform', lastName: 'E2E' })
    .expect(200);
  return { email, password };
}

async function login(app: NestExpressApplication, email: string, password: string): Promise<Account> {
  const { body } = await api(app)
    .post('/api/v1/auth/email/login')
    .set('X-Forwarded-For', randomIp())
    .send({ email, password })
    .expect(200);
  return { token: body.data.token as string, id: Number(body.data.user.id) };
}

async function registerAndLogin(app: NestExpressApplication): Promise<Account> {
  const { email, password } = await register(app);
  return login(app, email, password);
}

async function setRole(app: NestExpressApplication, email: string, role: RoleEnum): Promise<void> {
  const usersService = app.get(UsersService);
  const found = await usersService.findByEmail(email);
  if (found) {
    await usersService.update(found.id, { role: { id: role } });
  }
}

describe('Platform foundation', () => {
  let app: NestExpressApplication;
  let secondInstance: NestExpressApplication;
  let user: Account;
  let otherUser: Account;
  let admin: Account;
  let adminEmail: string | undefined;

  beforeAll(async () => {
    app = await createTestApp([ProbeController]);
    secondInstance = await createTestApp([ProbeController]);
    await app.get(PermissionsService).refreshCache();
    user = await registerAndLogin(app);
    otherUser = await registerAndLogin(app);
    const adminAccount = await register(app);
    adminEmail = adminAccount.email;
    await setRole(app, adminEmail, RoleEnum.admin);
    admin = await login(app, adminAccount.email, adminAccount.password);
  }, 120_000);

  afterAll(async () => {
    try {
      if (adminEmail) {
        await setRole(app, adminEmail, RoleEnum.user);
      }
    } finally {
      await app?.close();
      await secondInstance?.close();
    }
  });

  describe('optional authentication', () => {
    it('should identify the user with a valid token', async () => {
      const { body } = await api(app)
        .get('/api/v1/e2e-probe/whoami')
        .set('X-Forwarded-For', randomIp())
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(body.data.userId).toBe(user.id);
    });

    it('should treat requests without token or with an invalid token as guests', async () => {
      const guest = await api(app).get('/api/v1/e2e-probe/whoami').set('X-Forwarded-For', randomIp()).expect(200);
      expect(guest.body.data.userId).toBeNull();

      const invalid = await api(app)
        .get('/api/v1/e2e-probe/whoami')
        .set('X-Forwarded-For', randomIp())
        .set('Authorization', 'Bearer invalid.token.value')
        .expect(200);
      expect(invalid.body.data.userId).toBeNull();
    });
  });

  describe('per-user rate limiting', () => {
    it('should count a user across IPs and instances', async () => {
      const throttledUser = await registerAndLogin(app);
      const call = (instance: NestExpressApplication): request.Test =>
        api(instance)
          .get('/api/v1/e2e-probe/me')
          .set('X-Forwarded-For', randomIp())
          .set('Authorization', `Bearer ${throttledUser.token}`);

      await call(app).expect(200);
      await call(secondInstance).expect(200);
      await call(app).expect(200);
      await call(secondInstance).expect(429);
    });

    it('should count guests by IP', async () => {
      const ip = randomIp();
      for (let i = 0; i < PROBE_LIMIT; i++) {
        await api(app).get('/api/v1/e2e-probe/whoami').set('X-Forwarded-For', ip).expect(200);
      }
      await api(secondInstance).get('/api/v1/e2e-probe/whoami').set('X-Forwarded-For', ip).expect(429);
      await api(app).get('/api/v1/e2e-probe/whoami').set('X-Forwarded-For', randomIp()).expect(200);
    });
  });

  describe('file ownership and visibility', () => {
    const upload = (token: string, purpose: string | undefined, name: string): request.Test => {
      const req = api(app)
        .post('/api/v1/files/upload')
        .set('X-Forwarded-For', randomIp())
        .set('Authorization', `Bearer ${token}`);
      if (purpose) {
        req.query({ purpose });
      }
      return req.attach('file', Buffer.from('e2e'), name);
    };

    it('should let only the owner read a private file', async () => {
      const { body } = await upload(user.token, 'private-image', 'handwriting.jpg').expect(201);
      const file = body.data.file;
      expect(file.visibility).toBe('PRIVATE');
      expect(file.mimeType).toBe('image/jpeg');
      expect(file.ownerUserId).toBeUndefined();

      const privatePath = `/api/v1/files/private/${file.id}`;
      await api(app).get(privatePath).set('Authorization', `Bearer ${user.token}`).expect(200);
      await api(app).get(privatePath).set('Authorization', `Bearer ${otherUser.token}`).expect(403);
      await api(app).get(privatePath).expect(401);

      const fileName = (file.path as string).split('/').pop();
      await api(app).get(`/api/v1/files/${fileName}`).expect(404);
    });

    it('should keep public images readable by anyone', async () => {
      const { body } = await upload(user.token, undefined, 'avatar.png').expect(201);
      expect(body.data.file.visibility).toBe('PUBLIC');

      const fileName = (body.data.file.path as string).split('/').pop();
      await api(app).get(`/api/v1/files/${fileName}`).expect(200);
    });

    it('should let admins upload public audio', async () => {
      const { body } = await upload(admin.token, 'audio', 'listening.mp3').expect(201);
      expect(body.data.file.visibility).toBe('PUBLIC');
      expect(body.data.file.mimeType).toBe('audio/mpeg');
    });

    it('should reject audio uploads from regular users', async () => {
      await upload(user.token, 'audio', 'listening.mp3').expect(403);
    });

    it('should reject a type outside the purpose whitelist with 422', async () => {
      const { body } = await upload(user.token, 'image', 'listening.mp3').expect(422);
      expect(body.data.file).toBeDefined();
    });
  });

  describe('business permissions', () => {
    it('should let a regular user call a practice:write endpoint', async () => {
      await api(app).get('/api/v1/e2e-probe/practice').set('Authorization', `Bearer ${user.token}`).expect(200);
    });

    it('should reject a regular user on a content:manage endpoint', async () => {
      await api(app).get('/api/v1/e2e-probe/content').set('Authorization', `Bearer ${user.token}`).expect(403);
    });

    it('should let admins call a content:manage endpoint', async () => {
      await api(app).get('/api/v1/e2e-probe/content').set('Authorization', `Bearer ${admin.token}`).expect(200);
    });
  });

  describe('alerts', () => {
    const dedupKeys: string[] = [];

    afterAll(async () => {
      const dataSource = app.get(DataSource);
      const open: { id: number }[] = await dataSource.query(
        `SELECT "id" FROM "admin_alert" WHERE "dedupKey" = ANY($1) AND "acknowledgedAt" IS NULL`,
        [dedupKeys],
      );
      for (const { id } of open) {
        await app.get(AlertService).acknowledge(id);
      }
      await dataSource.query(`DELETE FROM "notification" WHERE "metadata"->>'dedupKey' = ANY($1)`, [dedupKeys]);
      await dataSource.query(`DELETE FROM "admin_alert" WHERE "dedupKey" = ANY($1)`, [dedupKeys]);
    });

    it('should deduplicate open alerts and create a new one after acknowledgement', async () => {
      const alerts = app.get(AlertService);
      const dedupKey = `e2e-${Date.now()}`;
      dedupKeys.push(dedupKey);

      const first = await alerts.raise('e2e', AlertLevel.WARN, 'e2e alert', { run: 1 }, dedupKey);
      const duplicate = await alerts.raise('e2e', AlertLevel.WARN, 'e2e alert', { run: 2 }, dedupKey);
      expect(first).not.toBeNull();
      expect(duplicate).toBeNull();

      const listed = await api(app)
        .get('/api/v1/admin/monitor/alerts')
        .query({ type: 'e2e', acknowledged: 'false', limit: 100 })
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      expect(listed.body.data.list.filter((alert: { dedupKey: string }) => alert.dedupKey === dedupKey)).toHaveLength(
        1,
      );

      const acked = await api(app)
        .post(`/api/v1/admin/monitor/alerts/${first!.id}/ack`)
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      expect(acked.body.data.acknowledgedAt).toBeTruthy();

      const again = await alerts.raise('e2e', AlertLevel.WARN, 'e2e alert', { run: 3 }, dedupKey);
      expect(again).not.toBeNull();
      expect(again!.id).not.toBe(first!.id);
    });

    it('should notify admins in app', async () => {
      const dedupKey = `e2e-notify-${Date.now()}`;
      dedupKeys.push(dedupKey);
      const alert = await app.get(AlertService).raise('e2e', AlertLevel.CRITICAL, dedupKey, null, dedupKey);

      const { body } = await api(app)
        .get('/api/v1/notifications')
        .query({ category: 'SYSTEM', limit: 50 })
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      expect(body.data.list.some((n: { metadata?: { alertId?: number } }) => n.metadata?.alertId === alert!.id)).toBe(
        true,
      );
    });

    it('should report queue status to admins only', async () => {
      const { body } = await api(app)
        .get('/api/v1/admin/monitor/queues')
        .set('Authorization', `Bearer ${admin.token}`)
        .expect(200);
      expect(body.data.enabled).toBe(true);
      expect(body.data.queues.map((queue: { name: string }) => queue.name)).toEqual([
        'mail',
        'notification',
        'content-import',
        'mock-submit',
        'study-stats',
      ]);

      await api(app).get('/api/v1/admin/monitor/queues').set('Authorization', `Bearer ${user.token}`).expect(403);
    });
  });

  describe('business error keys', () => {
    it('should return the error key in data with the mapped HTTP status', async () => {
      const { body } = await api(app).get('/api/v1/e2e-probe/taken-over').set('x-custom-lang', 'zh').expect(409);
      expect(body).toEqual({ code: 409, message: '考试已在其他设备继续', data: { errorKey: 'sessionTakenOver' } });
    });
  });
});
