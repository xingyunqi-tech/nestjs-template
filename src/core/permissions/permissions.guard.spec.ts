import type { Mock } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsService } from './permissions.service';
import { RequireAnyPermission, RequirePermissions } from './permissions.decorator';
import { Permission } from './permission.enum';
import { UsersController } from '../users/users.controller';
import { WechatPayController } from '../../modules/payments/wechat-pay.controller';
import { AlipayController } from '../../modules/payments/alipay.controller';
import { AppConfigController } from '../../modules/config/config.controller';
import { AdminPapersController } from '../../modules/papers/admin-papers.controller';
import { AdminExamsController } from '../../modules/exams/admin-exams.controller';
import { AdminSubjectsController } from '../../modules/exams/admin-subjects.controller';
import { PERMISSIONS_KEY } from './permissions.decorator';

class TestController {
  @RequirePermissions(Permission.USER_LIST)
  list(): void {}

  open(): void {}
}

function context(handler: string, roleId?: number): ExecutionContext {
  return {
    getClass: () => TestController,
    getHandler: () => (TestController.prototype as unknown as Record<string, unknown>)[handler],
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 1, role: roleId ? { id: roleId } : undefined } }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  const permissionsService = {
    getPermissionsForRole: vi.fn().mockResolvedValue([Permission.USER_LIST]),
  } as unknown as PermissionsService;
  const guard = new PermissionsGuard(new Reflector(), permissionsService);

  it('should allow a role holding the required permission', async () => {
    await expect(guard.canActivate(context('list', 1))).resolves.toBe(true);
  });

  it('should reject a role missing the required permission', async () => {
    (permissionsService.getPermissionsForRole as Mock).mockResolvedValueOnce([]);
    await expect(guard.canActivate(context('list', 2))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('should reject a guarded route that declares no permission', async () => {
    await expect(guard.canActivate(context('open', 1))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

@RequirePermissions(Permission.CONTENT_MANAGE)
class AnyOfController {
  @RequireAnyPermission(Permission.CONTENT_MANAGE, Permission.CONTENT_REVIEW)
  read(): void {}

  write(): void {}
}

describe('PermissionsGuard with any-of permissions', () => {
  const permissionsService = { getPermissionsForRole: vi.fn() };
  const guard = new PermissionsGuard(new Reflector(), permissionsService as unknown as PermissionsService);
  const anyOfContext = (handler: 'read' | 'write'): ExecutionContext =>
    ({
      getClass: () => AnyOfController,
      getHandler: () => AnyOfController.prototype[handler],
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 1, role: { id: 1 } } }) }),
    }) as unknown as ExecutionContext;

  it('should allow a role holding any one of the method permissions', async () => {
    permissionsService.getPermissionsForRole.mockResolvedValue([Permission.CONTENT_REVIEW]);

    await expect(guard.canActivate(anyOfContext('read'))).resolves.toBe(true);
    await expect(guard.canActivate(anyOfContext('write'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('should reject a role holding none of the permissions', async () => {
    permissionsService.getPermissionsForRole.mockResolvedValue([Permission.USER_LIST]);

    await expect(guard.canActivate(anyOfContext('read'))).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('admin endpoints', () => {
  const required = (target: object, method: string): unknown =>
    Reflect.getMetadata(PERMISSIONS_KEY, (target as Record<string, object>)[method]);

  it.each([
    ['UsersController.create', UsersController.prototype, 'create', Permission.USER_CREATE],
    ['UsersController.findAll', UsersController.prototype, 'findAll', Permission.USER_LIST],
    ['UsersController.findOne', UsersController.prototype, 'findOne', Permission.USER_READ],
    ['UsersController.update', UsersController.prototype, 'update', Permission.USER_UPDATE],
    ['UsersController.remove', UsersController.prototype, 'remove', Permission.USER_DELETE],
    ['WechatPayController.refund', WechatPayController.prototype, 'refund', Permission.PAYMENT_REFUND],
    ['AlipayController.refund', AlipayController.prototype, 'refund', Permission.PAYMENT_REFUND],
    [
      'AppConfigController.findByKeyAsAdmin',
      AppConfigController.prototype,
      'findByKeyAsAdmin',
      Permission.SYSTEM_CONFIG,
    ],
    ['AppConfigController.upsert', AppConfigController.prototype, 'upsert', Permission.SYSTEM_CONFIG],
    ['AdminPapersController.publish', AdminPapersController.prototype, 'publish', Permission.CONTENT_REVIEW],
    ['AdminPapersController.offline', AdminPapersController.prototype, 'offline', Permission.CONTENT_REVIEW],
    ['AdminExamsController.publish', AdminExamsController.prototype, 'publish', Permission.CONTENT_REVIEW],
    ['AdminExamsController.offline', AdminExamsController.prototype, 'offline', Permission.CONTENT_REVIEW],
    ['AdminSubjectsController.publish', AdminSubjectsController.prototype, 'publish', Permission.CONTENT_REVIEW],
    ['AdminSubjectsController.offline', AdminSubjectsController.prototype, 'offline', Permission.CONTENT_REVIEW],
  ])('should require a permission on %s', (_label, target, method, permission) => {
    expect(required(target, method)).toEqual([permission]);
  });
});
