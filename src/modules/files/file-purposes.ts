import { HttpStatus, PayloadTooLargeException, UnprocessableEntityException } from '@nestjs/common';
import { FilePurpose } from './domain/file-purpose';
import { FileVisibility } from './domain/file-visibility';
import { Permission } from '../../core/permissions/permission.enum';

export interface FilePurposeRule {
  mimeTypes: Readonly<Record<string, string>>;
  visibility: FileVisibility;
  permission?: Permission;
}

const IMAGE_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

export const FILE_PURPOSE_RULES: Readonly<Record<FilePurpose, FilePurposeRule>> = {
  [FilePurpose.IMAGE]: { mimeTypes: IMAGE_TYPES, visibility: FileVisibility.PUBLIC },
  [FilePurpose.PRIVATE_IMAGE]: {
    mimeTypes: { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' },
    visibility: FileVisibility.PRIVATE,
  },
  [FilePurpose.AUDIO]: {
    mimeTypes: { mp3: 'audio/mpeg', m4a: 'audio/mp4' },
    visibility: FileVisibility.PUBLIC,
    permission: Permission.CONTENT_MANAGE,
  },
  [FilePurpose.IMPORT]: {
    mimeTypes: {
      zip: 'application/zip',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      json: 'application/json',
    },
    visibility: FileVisibility.PRIVATE,
    permission: Permission.CONTENT_MANAGE,
  },
  [FilePurpose.EXPORT]: {
    mimeTypes: { pdf: 'application/pdf' },
    visibility: FileVisibility.PRIVATE,
    permission: Permission.CONTENT_MANAGE,
  },
};

/** 未传用途时按公开图片处理，无法识别时返回 null */
export function parseFilePurpose(value: unknown): FilePurpose | null {
  if (value === undefined || value === '') {
    return FilePurpose.IMAGE;
  }
  return Object.values(FilePurpose).includes(value as FilePurpose) ? (value as FilePurpose) : null;
}

export function fileExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index >= 0 ? fileName.slice(index + 1).toLowerCase() : '';
}

export function mimeTypeFor(purpose: FilePurpose, fileName: string): string | null {
  const mimeTypes = FILE_PURPOSE_RULES[purpose].mimeTypes;
  const extension = fileExtension(fileName);
  return Object.prototype.hasOwnProperty.call(mimeTypes, extension) ? mimeTypes[extension] : null;
}

export function invalidPurposeError(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    errors: { purpose: 'invalidFilePurpose' },
  });
}

export function fileTypeNotAllowedError(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    errors: { file: 'cantUploadFileType' },
  });
}

export function fileTooLargeError(): PayloadTooLargeException {
  return new PayloadTooLargeException({
    status: HttpStatus.PAYLOAD_TOO_LARGE,
    errors: { file: 'fileTooLarge' },
  });
}

export function purposeFileFilter(
  request: { query?: Record<string, unknown> },
  file: { originalname: string },
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  const purpose = parseFilePurpose(request.query?.purpose);
  if (!purpose) {
    callback(invalidPurposeError(), false);
    return;
  }
  if (!mimeTypeFor(purpose, file.originalname)) {
    callback(fileTypeNotAllowedError(), false);
    return;
  }
  callback(null, true);
}
