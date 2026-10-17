import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PermissionEntity } from '../../../../../core/permissions/infrastructure/persistence/permission.entity';
import { RolePermissionEntity } from '../../../../../core/permissions/infrastructure/persistence/role-permission.entity';
import { Permission } from '../../../../../core/permissions/permission.enum';
import { RolePermissions } from '../../../../../core/permissions/role-permissions';

import { EXAM_PREP_PERMISSIONS, PermissionData } from './exam-prep-permissions';

const PERMISSIONS_DATA: PermissionData[] = [
  // User Management
  { id: Permission.USER_READ, name: 'Read User', description: 'View user details', resource: 'user', action: 'read' },
  {
    id: Permission.USER_CREATE,
    name: 'Create User',
    description: 'Create new users',
    resource: 'user',
    action: 'create',
  },
  {
    id: Permission.USER_UPDATE,
    name: 'Update User',
    description: 'Update user information',
    resource: 'user',
    action: 'update',
  },
  { id: Permission.USER_DELETE, name: 'Delete User', description: 'Delete users', resource: 'user', action: 'delete' },
  { id: Permission.USER_LIST, name: 'List Users', description: 'View user list', resource: 'user', action: 'list' },

  // Address Management
  {
    id: Permission.ADDRESS_READ,
    name: 'Read Address',
    description: 'View address details',
    resource: 'address',
    action: 'read',
  },
  {
    id: Permission.ADDRESS_CREATE,
    name: 'Create Address',
    description: 'Create new addresses',
    resource: 'address',
    action: 'create',
  },
  {
    id: Permission.ADDRESS_UPDATE,
    name: 'Update Address',
    description: 'Update address information',
    resource: 'address',
    action: 'update',
  },
  {
    id: Permission.ADDRESS_DELETE,
    name: 'Delete Address',
    description: 'Delete addresses',
    resource: 'address',
    action: 'delete',
  },

  // Favorite Management
  {
    id: Permission.FAVORITE_READ,
    name: 'Read Favorite',
    description: 'View favorites',
    resource: 'favorite',
    action: 'read',
  },
  {
    id: Permission.FAVORITE_CREATE,
    name: 'Create Favorite',
    description: 'Add to favorites',
    resource: 'favorite',
    action: 'create',
  },
  {
    id: Permission.FAVORITE_DELETE,
    name: 'Delete Favorite',
    description: 'Remove from favorites',
    resource: 'favorite',
    action: 'delete',
  },

  // Feedback Management
  {
    id: Permission.FEEDBACK_READ,
    name: 'Read Feedback',
    description: 'View feedback details',
    resource: 'feedback',
    action: 'read',
  },
  {
    id: Permission.FEEDBACK_CREATE,
    name: 'Create Feedback',
    description: 'Submit feedback',
    resource: 'feedback',
    action: 'create',
  },
  {
    id: Permission.FEEDBACK_LIST,
    name: 'List Feedback',
    description: 'View feedback list',
    resource: 'feedback',
    action: 'list',
  },

  // File Management
  {
    id: Permission.FILE_UPLOAD,
    name: 'Upload File',
    description: 'Upload files',
    resource: 'file',
    action: 'upload',
  },
  { id: Permission.FILE_READ, name: 'Read File', description: 'Download files', resource: 'file', action: 'read' },
  { id: Permission.FILE_DELETE, name: 'Delete File', description: 'Delete files', resource: 'file', action: 'delete' },

  // Session Management
  {
    id: Permission.SESSION_READ,
    name: 'Read Session',
    description: 'View session details',
    resource: 'session',
    action: 'read',
  },
  {
    id: Permission.SESSION_DELETE,
    name: 'Delete Session',
    description: 'Terminate sessions',
    resource: 'session',
    action: 'delete',
  },

  // System Management (Admin only)
  {
    id: Permission.SYSTEM_CONFIG,
    name: 'System Config',
    description: 'Manage system configuration',
    resource: 'system',
    action: 'config',
  },
  {
    id: Permission.SYSTEM_METRICS,
    name: 'System Metrics',
    description: 'View system metrics',
    resource: 'system',
    action: 'metrics',
  },

  // Payment Management (Admin only)
  {
    id: Permission.PAYMENT_REFUND,
    name: 'Refund Payment',
    description: 'Refund paid orders',
    resource: 'payment',
    action: 'refund',
  },

  // Audit Log (Admin only)
  {
    id: Permission.AUDIT_READ,
    name: 'Read Audit',
    description: 'View audit log details',
    resource: 'audit',
    action: 'read',
  },
  {
    id: Permission.AUDIT_LIST,
    name: 'List Audit',
    description: 'View audit logs',
    resource: 'audit',
    action: 'list',
  },

  // Exam Prep
  ...EXAM_PREP_PERMISSIONS,
];

@Injectable()
export class PermissionSeedService {
  private readonly logger = new Logger(PermissionSeedService.name);

  constructor(
    @InjectRepository(PermissionEntity)
    private permissionRepository: Repository<PermissionEntity>,
    @InjectRepository(RolePermissionEntity)
    private rolePermissionRepository: Repository<RolePermissionEntity>,
  ) {}

  async run(): Promise<void> {
    await this.seedPermissions();
    await this.seedRolePermissions();
  }

  private async seedPermissions(): Promise<void> {
    for (const permData of PERMISSIONS_DATA) {
      const exists = await this.permissionRepository.count({
        where: { id: permData.id },
      });

      if (!exists) {
        await this.permissionRepository.save(this.permissionRepository.create(permData));
        this.logger.log(`Created permission: ${permData.id}`);
      }
    }
  }

  private async seedRolePermissions(): Promise<void> {
    for (const [roleIdStr, permissions] of Object.entries(RolePermissions)) {
      const roleId = Number(roleIdStr);

      for (const permissionId of permissions) {
        const exists = await this.rolePermissionRepository.count({
          where: { roleId, permissionId },
        });

        if (!exists) {
          await this.rolePermissionRepository.save(
            this.rolePermissionRepository.create({
              roleId,
              permissionId,
            }),
          );
        }
      }

      this.logger.log(`Seeded ${permissions.length} permissions for role ${roleId}`);
    }
  }
}
