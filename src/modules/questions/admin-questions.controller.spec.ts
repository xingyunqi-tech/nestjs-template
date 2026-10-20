import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminQuestionsController } from './admin-questions.controller';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { Permission } from '../../core/permissions/permission.enum';
import { QuestionsService } from './questions.service';
import { QuestionAction } from './domain/question-status';
import { RoleEnum } from '../../common/enums/roles/roles.enum';
import type { RequestWithUser } from '../../common/types/request-with-user.type';
import { AUDITABLE_KEY, AuditAction, AuditableOptions } from '../../infrastructure/audit';

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

describe('AdminQuestionsController operators', () => {
  const request = { user: { id: 5, role: { id: RoleEnum.reviewer } } } as unknown as RequestWithUser;
  const operator = { id: 5, roleId: RoleEnum.reviewer };
  let service: { [K in 'create' | 'changeStatus' | 'reject' | 'batchPublish']: ReturnType<typeof vi.fn> };
  let controller: AdminQuestionsController;

  beforeEach(() => {
    service = {
      create: vi.fn().mockResolvedValue({}),
      changeStatus: vi.fn().mockResolvedValue({}),
      reject: vi.fn().mockResolvedValue({}),
      batchPublish: vi.fn().mockResolvedValue({ count: 1 }),
    };
    controller = new AdminQuestionsController(service as unknown as QuestionsService);
  });

  it('should pass the reject reason and the operator role', async () => {
    await controller.reject('q1', { reason: '答案有误' }, request);

    expect(service.reject).toHaveBeenCalledWith('q1', '答案有误', operator);
  });

  it('should pass the operator role to status changes and batch publish', async () => {
    await controller.submit('q1', request);
    await controller.publish('q1', request);
    await controller.offline('q1', request);
    await controller.batchPublish({ ids: ['q1'] }, request);

    expect(service.changeStatus.mock.calls).toEqual([
      ['q1', QuestionAction.SUBMIT, operator],
      ['q1', QuestionAction.PUBLISH, operator],
      ['q1', QuestionAction.OFFLINE, operator],
    ]);
    expect(service.batchPublish).toHaveBeenCalledWith({ ids: ['q1'] }, operator);
  });

  it('should create questions as the requesting user', async () => {
    await controller.create({} as never, request);

    expect(service.create).toHaveBeenCalledWith({}, 5);
  });
});

describe('AdminQuestionsController audit', () => {
  const auditOf = (handler: Handler): AuditableOptions | undefined =>
    Reflect.getMetadata(AUDITABLE_KEY, AdminQuestionsController.prototype[handler]) as AuditableOptions | undefined;

  it('should audit every write endpoint and no read endpoint', () => {
    for (const handler of ['findAll', 'findOne', 'findVersions'] as const) {
      expect(auditOf(handler)).toBeUndefined();
    }
    expect(auditOf('create')).toMatchObject({ action: AuditAction.CREATE, entityType: 'Question', includeBody: false });
    expect(auditOf('update')).toMatchObject({ action: AuditAction.UPDATE, entityType: 'Question', includeBody: false });
    expect(auditOf('remove')).toMatchObject({ action: AuditAction.DELETE, entityType: 'Question' });
    const actions = {
      submit: AuditAction.SUBMIT,
      publish: AuditAction.PUBLISH,
      reject: AuditAction.REJECT,
      offline: AuditAction.OFFLINE,
      batchPublish: AuditAction.PUBLISH,
    } as const;
    for (const [handler, action] of Object.entries(actions) as [Handler, AuditAction][]) {
      expect(auditOf(handler)).toMatchObject({ action, entityType: 'Question', includeBody: true });
    }
  });
});
