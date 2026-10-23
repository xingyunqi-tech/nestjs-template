import type { Mocked } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { AdminPaperRulesController } from './admin-paper-rules.controller';
import { PaperRulesService } from './paper-rules.service';
import { PaperRule } from './domain/paper-rule';
import { ContentStatus } from '../exams/domain/content-status';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { Permission } from '../../core/permissions/permission.enum';
import { RoleEnum } from '../../common/enums/roles/roles.enum';
import type { RequestWithUser } from '../../common/types/request-with-user.type';

const RULE_ID = '00000000-0000-4000-8000-000000000001';

const requestAs = (roleId?: RoleEnum): RequestWithUser =>
  ({ user: { id: 1, role: roleId === undefined ? undefined : { id: roleId } } }) as unknown as RequestWithUser;

describe('AdminPaperRulesController.update', () => {
  let paperRulesService: Mocked<Pick<PaperRulesService, 'update'>>;
  let permissionsService: Mocked<Pick<PermissionsService, 'hasPermission'>>;
  let controller: AdminPaperRulesController;

  beforeEach(() => {
    paperRulesService = {
      update: vi.fn().mockResolvedValue(new PaperRule()),
    };
    permissionsService = {
      hasPermission: vi.fn(async (roleId: RoleEnum) => roleId === RoleEnum.reviewer),
    };
    controller = new AdminPaperRulesController(
      paperRulesService as unknown as PaperRulesService,
      permissionsService as unknown as PermissionsService,
    );
  });

  it('should restrict a role without content review to draft rules', async () => {
    await controller.update(RULE_ID, { name: '新规则' }, requestAs(RoleEnum.editor));

    expect(paperRulesService.update).toHaveBeenCalledWith(RULE_ID, { name: '新规则' }, { draftOnly: true });
  });

  it('should let a role with content review edit rules in any status', async () => {
    await controller.update(RULE_ID, { name: '新规则' }, requestAs(RoleEnum.reviewer));

    expect(paperRulesService.update).toHaveBeenCalledWith(RULE_ID, { name: '新规则' }, { draftOnly: false });
  });

  it('should reject a status change from a role without content review', async () => {
    await expect(
      controller.update(RULE_ID, { status: ContentStatus.PUBLISHED }, requestAs(RoleEnum.editor)),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(permissionsService.hasPermission).toHaveBeenCalledWith(RoleEnum.editor, Permission.CONTENT_REVIEW);
    expect(paperRulesService.update).not.toHaveBeenCalled();
  });

  it('should reject a status change from a user without a role', async () => {
    await expect(controller.update(RULE_ID, { status: ContentStatus.OFFLINE }, requestAs())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(paperRulesService.update).not.toHaveBeenCalled();
  });

  it('should allow a status change from a role with content review', async () => {
    await controller.update(RULE_ID, { status: ContentStatus.PUBLISHED }, requestAs(RoleEnum.reviewer));

    expect(paperRulesService.update).toHaveBeenCalledWith(
      RULE_ID,
      { status: ContentStatus.PUBLISHED },
      { draftOnly: false },
    );
  });
});
