import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { FILE_PURPOSE_RULES, fileTooLargeError, invalidPurposeError, parseFilePurpose } from './file-purposes';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { AllConfigType } from '../../config/config.type';

const MULTIPART_OVERHEAD_BYTES = 16 * 1024;

/** 须在 JWT 鉴权之后使用 */
@Injectable()
export class FileUploadPurposeGuard implements CanActivate {
  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: { role?: { id?: number } | null } }>();
    const purpose = parseFilePurpose(request.query?.purpose);
    if (!purpose) {
      throw invalidPurposeError();
    }

    const permission = FILE_PURPOSE_RULES[purpose].permission;
    if (permission) {
      const roleId = request.user?.role?.id;
      if (roleId === undefined || !(await this.permissionsService.hasPermission(roleId, permission))) {
        throw new ForbiddenException(`Missing permissions: ${permission}`);
      }
    }

    const contentLength = Number(request.headers['content-length']);
    const maxSize = this.configService.getOrThrow('file.maxSizes', { infer: true })[purpose];
    if (Number.isFinite(contentLength) && contentLength > maxSize + MULTIPART_OVERHEAD_BYTES) {
      throw fileTooLargeError();
    }
    return true;
  }
}
