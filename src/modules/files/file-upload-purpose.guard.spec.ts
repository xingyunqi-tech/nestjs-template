import {
  ExecutionContext,
  ForbiddenException,
  PayloadTooLargeException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileUploadPurposeGuard } from './file-upload-purpose.guard';
import { PermissionsService } from '../../core/permissions/permissions.service';
import { Permission } from '../../core/permissions/permission.enum';
import { RoleEnum } from '../../common/enums/roles/roles.enum';
import { FilePurpose } from './domain/file-purpose';

const MB = 1024 * 1024;
const MAX_SIZES: Record<FilePurpose, number> = {
  [FilePurpose.IMAGE]: 5 * MB,
  [FilePurpose.PRIVATE_IMAGE]: 10 * MB,
  [FilePurpose.CONTENT_IMAGE]: 5 * MB,
  [FilePurpose.AUDIO]: 20 * MB,
  [FilePurpose.IMPORT]: 50 * MB,
  [FilePurpose.EXPORT]: 20 * MB,
};

function context(purpose: string | undefined, roleId?: RoleEnum, contentLength?: number): ExecutionContext {
  const request = {
    query: purpose === undefined ? {} : { purpose },
    headers: contentLength === undefined ? {} : { 'content-length': String(contentLength) },
    user: { id: 1, role: { id: roleId } },
  };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('FileUploadPurposeGuard', () => {
  const permissionsService = {
    hasPermission: vi.fn(async (roleId: RoleEnum, permission: Permission) =>
      roleId === RoleEnum.admin ? true : permission !== Permission.CONTENT_MANAGE,
    ),
  } as unknown as PermissionsService;
  const configService = { getOrThrow: () => MAX_SIZES } as unknown as ConfigService;
  const guard = new FileUploadPurposeGuard(permissionsService, configService);

  it('should allow users to upload images and private photos', async () => {
    await expect(guard.canActivate(context(undefined, RoleEnum.user))).resolves.toBe(true);
    await expect(guard.canActivate(context('private-image', RoleEnum.user))).resolves.toBe(true);
  });

  it('should allow admins to upload audio and content images', async () => {
    await expect(guard.canActivate(context('audio', RoleEnum.admin, 15 * MB))).resolves.toBe(true);
    await expect(guard.canActivate(context('content-image', RoleEnum.admin))).resolves.toBe(true);
  });

  it('should reject users uploading audio or import packages with 403', async () => {
    await expect(guard.canActivate(context('audio', RoleEnum.user))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context('import', RoleEnum.user))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(context('content-image', RoleEnum.user))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('should reject an unknown purpose with 422', async () => {
    await expect(guard.canActivate(context('video', RoleEnum.admin))).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('should reject a request body beyond the purpose limit with 413 before upload', async () => {
    const rejected = guard.canActivate(context('image', RoleEnum.user, 6 * MB));
    await expect(rejected).rejects.toBeInstanceOf(PayloadTooLargeException);
    await expect(rejected).rejects.toMatchObject({ response: { errors: { file: 'fileTooLarge' } } });
  });

  it('should accept a request body within the purpose limit plus multipart overhead', async () => {
    await expect(guard.canActivate(context('image', RoleEnum.user, 5 * MB + 1024))).resolves.toBe(true);
  });
});
