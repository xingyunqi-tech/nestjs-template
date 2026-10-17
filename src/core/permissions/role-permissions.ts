import { RoleEnum } from '../../common/enums/roles/roles.enum';
import { Permission } from './permission.enum';

/**
 * Mapping of roles to their permitted actions.
 * Admin has all permissions, regular users have a subset.
 */
export const RolePermissions: Record<RoleEnum, Permission[]> = {
  [RoleEnum.admin]: Object.values(Permission),

  [RoleEnum.user]: [
    // User can manage their own addresses
    Permission.ADDRESS_READ,
    Permission.ADDRESS_CREATE,
    Permission.ADDRESS_UPDATE,
    Permission.ADDRESS_DELETE,

    // User can manage their own favorites
    Permission.FAVORITE_READ,
    Permission.FAVORITE_CREATE,
    Permission.FAVORITE_DELETE,

    // User can create and read their own feedback
    Permission.FEEDBACK_READ,
    Permission.FEEDBACK_CREATE,

    // User can upload and read files
    Permission.FILE_UPLOAD,
    Permission.FILE_READ,

    // User can read their own sessions
    Permission.SESSION_READ,
    // Exam prep learning features
    Permission.PRACTICE_WRITE,
    Permission.AI_CHAT,
    Permission.AI_GRADING,
  ],
};

/**
 * Check if a role has a specific permission
 */
export function hasPermission(roleId: RoleEnum, permission: Permission): boolean {
  const permissions = RolePermissions[roleId];
  return permissions?.includes(permission) ?? false;
}

/**
 * Get all permissions for a role
 */
export function getPermissionsForRole(roleId: RoleEnum): Permission[] {
  return RolePermissions[roleId] ?? [];
}
