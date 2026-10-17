import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission } from './permission.enum';
import { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } from './permissions.decorator';
import { PermissionsService } from './permissions.service';
import { RoleEnum } from '../../common/enums/roles/roles.enum';

interface RequestUser {
  id: string | number;
  role?: { id: RoleEnum };
}

/**
 * Guard that checks if the user has the required permissions.
 * Must be used after authentication (JwtAuthGuard).
 * Routes guarded without @RequirePermissions() are rejected.
 *
 * The guard checks the user's role and verifies if that role
 * has all the permissions specified by @RequirePermissions().
 *
 * @example
 * ```typescript
 * @Controller('users')
 * @UseGuards(AuthGuard('jwt'), PermissionsGuard)
 * export class UsersController {
 *   @Delete(':id')
 *   @RequirePermissions(Permission.USER_DELETE)
 *   async remove(@Param('id') id: number) {
 *     return this.usersService.remove(id);
 *   }
 * }
 * ```
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { permissions: requiredPermissions, anyOf } = this.resolveRequirement(context);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      throw new ForbiddenException('No permission declared for this route');
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser | undefined;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    const roleId = user.role?.id;
    if (roleId === undefined) {
      throw new ForbiddenException('User role not found');
    }

    // Get user permissions from database (with caching)
    const userPermissions = await this.permissionsService.getPermissionsForRole(roleId);

    if (anyOf) {
      if (!requiredPermissions.some((permission) => userPermissions.includes(permission))) {
        throw new ForbiddenException(`Missing any of permissions: ${requiredPermissions.join(', ')}`);
      }
      return true;
    }

    const hasAllPermissions = requiredPermissions.every((permission) => userPermissions.includes(permission));

    if (!hasAllPermissions) {
      const missingPermissions = requiredPermissions.filter((permission) => !userPermissions.includes(permission));
      throw new ForbiddenException(`Missing permissions: ${missingPermissions.join(', ')}`);
    }

    return true;
  }

  private resolveRequirement(context: ExecutionContext): { permissions?: Permission[]; anyOf: boolean } {
    for (const target of [context.getHandler(), context.getClass()]) {
      const anyOf = this.reflector.get<Permission[] | undefined>(ANY_PERMISSIONS_KEY, target);
      if (anyOf) {
        return { permissions: anyOf, anyOf: true };
      }
      const allOf = this.reflector.get<Permission[] | undefined>(PERMISSIONS_KEY, target);
      if (allOf) {
        return { permissions: allOf, anyOf: false };
      }
    }
    return { anyOf: false };
  }
}
