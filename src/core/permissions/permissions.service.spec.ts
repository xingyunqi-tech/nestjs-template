import type { Mocked } from 'vitest';
import { Cache } from 'cache-manager';
import { PermissionsService } from './permissions.service';
import { PermissionRepository } from './infrastructure/persistence/permission.repository';
import { RoleEnum } from '../../common/enums/roles/roles.enum';
import { Permission } from './permission.enum';

describe('PermissionsService', () => {
  let repository: Mocked<
    Pick<PermissionRepository, 'findAllRolePermissions' | 'addPermissionToRole' | 'setRolePermissions'>
  >;
  let cache: Map<string, unknown>;
  let service: PermissionsService;

  beforeEach(() => {
    repository = {
      findAllRolePermissions: vi.fn().mockResolvedValue(new Map()),
      addPermissionToRole: vi.fn(),
      setRolePermissions: vi.fn(),
    };
    cache = new Map();
    const cacheManager = {
      get: async (key: string) => cache.get(key),
      set: async (key: string, value: unknown) => cache.set(key, value),
      del: async (key: string) => cache.delete(key),
    } as unknown as Cache;
    service = new PermissionsService(repository as unknown as PermissionRepository, cacheManager);
  });

  it('should always grant every permission to admins', async () => {
    repository.findAllRolePermissions.mockResolvedValue(new Map([[RoleEnum.user, [Permission.FILE_READ]]]));

    await expect(service.getPermissionsForRole(RoleEnum.admin)).resolves.toEqual(Object.values(Permission));
  });

  it('should use the built-in defaults when no role permission is stored', async () => {
    await expect(service.getPermissionsForRole(RoleEnum.user)).resolves.toContain(Permission.ADDRESS_READ);
  });

  it('should grant nothing to a role without stored permissions once the table is populated', async () => {
    repository.findAllRolePermissions.mockResolvedValue(new Map([[3, [Permission.FILE_READ]]]));

    await expect(service.getPermissionsForRole(RoleEnum.user)).resolves.toEqual([]);
  });

  it('should load all roles with one query and serve later lookups from the cache', async () => {
    repository.findAllRolePermissions.mockResolvedValue(new Map([[RoleEnum.user, [Permission.FILE_READ]]]));

    await service.getPermissionsForRole(RoleEnum.user);
    await service.getPermissionsForRole(RoleEnum.user);

    expect(repository.findAllRolePermissions).toHaveBeenCalledTimes(1);
  });

  it('should reload every role after a permission change', async () => {
    await service.getPermissionsForRole(RoleEnum.user);
    repository.findAllRolePermissions.mockResolvedValue(new Map([[3, [Permission.FILE_READ]]]));

    await service.addPermissionToRole(3 as RoleEnum, Permission.FILE_READ);

    await expect(service.getPermissionsForRole(RoleEnum.user)).resolves.toEqual([]);
  });

  it('should not grant user management to regular users by default', async () => {
    const permissions = await service.getPermissionsForRole(RoleEnum.user);

    expect(permissions).not.toContain(Permission.USER_READ);
    expect(permissions).not.toContain(Permission.USER_UPDATE);
  });

  it('should grant exam prep learning permissions to regular users by default', async () => {
    const permissions = await service.getPermissionsForRole(RoleEnum.user);
    expect(permissions).toEqual(
      expect.arrayContaining([Permission.PRACTICE_WRITE, Permission.AI_CHAT, Permission.AI_GRADING]),
    );
  });

  it('should keep exam prep management permissions to admins', async () => {
    const userPermissions = await service.getPermissionsForRole(RoleEnum.user);
    const adminPermissions = await service.getPermissionsForRole(RoleEnum.admin);
    const managementPermissions = [
      Permission.CONTENT_MANAGE,
      Permission.CONTENT_REVIEW,
      Permission.AI_GENERATE,
      Permission.AI_ADMIN,
    ];

    managementPermissions.forEach((permission) => expect(userPermissions).not.toContain(permission));
    expect(adminPermissions).toEqual(expect.arrayContaining(managementPermissions));
  });
});
