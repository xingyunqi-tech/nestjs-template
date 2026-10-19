import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminAppProfileController } from './admin-app-profile.controller';
import { PERMISSIONS_KEY } from '../../core/permissions/permissions.decorator';
import { Permission } from '../../core/permissions/permission.enum';
import { PermissionsGuard } from '../../core/permissions/permissions.guard';

describe('AdminAppProfileController', () => {
  it('should require the system config permission to update', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminAppProfileController)).toEqual([Permission.SYSTEM_CONFIG]);
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminAppProfileController)).toContain(PermissionsGuard);
  });
});
