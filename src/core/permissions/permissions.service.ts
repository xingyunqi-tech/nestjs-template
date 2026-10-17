import { Injectable, Logger, Inject } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PermissionRepository } from './infrastructure/persistence/permission.repository';
import { Permission } from './permission.enum';
import { RoleEnum } from '../../common/enums/roles/roles.enum';
import { RolePermissions as DefaultRolePermissions } from './role-permissions';

export const ROLE_PERMISSIONS_CACHE_KEY = 'permissions:v2:role-map';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type RolePermissionMap = Record<number, string[]>;

@Injectable()
export class PermissionsService {
  private readonly logger = new Logger(PermissionsService.name);

  constructor(
    private readonly permissionRepository: PermissionRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * 获取角色的权限列表；管理员始终拥有全部权限，角色权限表为空（未执行种子）时其他角色使用内置默认配置
   */
  async getPermissionsForRole(roleId: RoleEnum): Promise<string[]> {
    if (roleId === RoleEnum.admin) {
      return Object.values(Permission);
    }
    const map = await this.getRolePermissionMap();
    return map[roleId] ?? [];
  }

  private async getRolePermissionMap(): Promise<RolePermissionMap> {
    const cached = await this.cacheManager.get<RolePermissionMap>(ROLE_PERMISSIONS_CACHE_KEY);
    if (cached) {
      return cached;
    }

    const stored = await this.permissionRepository.findAllRolePermissions();
    const map: RolePermissionMap = stored.size > 0 ? Object.fromEntries(stored) : { ...DefaultRolePermissions };

    await this.cacheManager.set(ROLE_PERMISSIONS_CACHE_KEY, map, CACHE_TTL_MS);
    return map;
  }

  /**
   * 检查角色是否有指定权限
   */
  async hasPermission(roleId: RoleEnum, permission: Permission): Promise<boolean> {
    const permissions = await this.getPermissionsForRole(roleId);
    return permissions.includes(permission);
  }

  /**
   * 检查角色是否有所有指定权限
   */
  async hasAllPermissions(roleId: RoleEnum, requiredPermissions: Permission[]): Promise<boolean> {
    const permissions = await this.getPermissionsForRole(roleId);
    return requiredPermissions.every((p) => permissions.includes(p));
  }

  /**
   * 设置角色权限
   */
  async setRolePermissions(roleId: RoleEnum, permissionIds: string[]): Promise<void> {
    await this.permissionRepository.setRolePermissions(roleId, permissionIds);
    await this.invalidateRoleCache(roleId);
  }

  /**
   * 为角色添加权限
   */
  async addPermissionToRole(roleId: RoleEnum, permissionId: string): Promise<void> {
    await this.permissionRepository.addPermissionToRole(roleId, permissionId);
    await this.invalidateRoleCache(roleId);
  }

  /**
   * 从角色移除权限
   */
  async removePermissionFromRole(roleId: RoleEnum, permissionId: string): Promise<void> {
    await this.permissionRepository.removePermissionFromRole(roleId, permissionId);
    await this.invalidateRoleCache(roleId);
  }

  /**
   * 角色权限变更后清除缓存；表从空变为非空会影响所有角色，因此整体失效
   */
  private async invalidateRoleCache(roleId: RoleEnum): Promise<void> {
    await this.refreshCache();
    this.logger.debug(`Cache invalidated after permission change of role: ${roleId}`);
  }

  /**
   * 清除角色权限缓存
   */
  async refreshCache(): Promise<void> {
    await this.cacheManager.del(ROLE_PERMISSIONS_CACHE_KEY);
    this.logger.log('Permission cache refreshed');
  }

  /**
   * 获取所有权限
   */
  async getAllPermissions(): Promise<{ id: string; name: string; description?: string }[]> {
    const permissions = await this.permissionRepository.findAll();
    if (permissions.length === 0) {
      // 返回枚举中的默认权限
      return Object.values(Permission).map((p) => ({
        id: p,
        name: p,
        description: undefined,
      }));
    }
    return permissions.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));
  }
}
