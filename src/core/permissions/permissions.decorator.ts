import { SetMetadata } from '@nestjs/common';
import { Permission } from './permission.enum';

export const PERMISSIONS_KEY = 'permissions';
export const ANY_PERMISSIONS_KEY = 'anyPermissions';

/**
 * Decorator to require specific permissions for a route.
 * Works in conjunction with PermissionsGuard.
 *
 * @param permissions - One or more permissions required to access the route
 *
 * @example
 * Single permission:
 * ```typescript
 * @Delete(':id')
 * @RequirePermissions(Permission.USER_DELETE)
 * async remove(@Param('id') id: number) {
 *   return this.usersService.remove(id);
 * }
 * ```
 *
 * @example
 * Multiple permissions (all required):
 * ```typescript
 * @Put(':id/role')
 * @RequirePermissions(Permission.USER_UPDATE, Permission.SYSTEM_CONFIG)
 * async updateRole(@Param('id') id: number, @Body() dto: UpdateRoleDto) {
 *   return this.usersService.updateRole(id, dto);
 * }
 * ```
 */
export const RequirePermissions = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** 持有其中任一权限即可访问；方法上的声明优先于类上的声明 */
export const RequireAnyPermission = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ANY_PERMISSIONS_KEY, permissions);
