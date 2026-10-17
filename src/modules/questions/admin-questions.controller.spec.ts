import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminQuestionsController } from './admin-questions.controller';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { Permission } from '../../core/permissions/permission.enum';

type Handler = keyof AdminQuestionsController;

function guardFor(permissions: Permission[]): (handler: Handler) => Promise<boolean> {
  const permissionsService = { getPermissionsForRole: vi.fn().mockResolvedValue(permissions) };
  const guard = new PermissionsGuard(new Reflector(), permissionsService as unknown as PermissionsService);
  return (handler) =>
    guard.canActivate({
      getClass: () => AdminQuestionsController,
      getHandler: () => AdminQuestionsController.prototype[handler],
      switchToHttp: () => ({ getRequest: () => ({ user: { id: 1, role: { id: 1 } } }) }),
    } as unknown as ExecutionContext);
}

describe('AdminQuestionsController permissions', () => {
  it('should let a review-only role read questions but not edit them', async () => {
    const canActivate = guardFor([Permission.CONTENT_REVIEW]);

    for (const handler of ['findAll', 'findOne', 'publish', 'reject', 'offline', 'batchPublish'] as const) {
      await expect(canActivate(handler)).resolves.toBe(true);
    }
    for (const handler of ['create', 'update', 'remove', 'submit', 'findVersions'] as const) {
      await expect(canActivate(handler)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('should let a manage-only role edit but not review', async () => {
    const canActivate = guardFor([Permission.CONTENT_MANAGE]);

    for (const handler of ['findAll', 'findOne', 'create', 'update', 'remove', 'submit', 'findVersions'] as const) {
      await expect(canActivate(handler)).resolves.toBe(true);
    }
    for (const handler of ['publish', 'reject', 'offline', 'batchPublish'] as const) {
      await expect(canActivate(handler)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});
