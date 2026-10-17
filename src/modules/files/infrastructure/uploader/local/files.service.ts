import { HttpStatus, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { unlink } from 'fs/promises';

import { FileRepository } from '../../persistence/file.repository';
import { AllConfigType } from '../../../../../config/config.type';
import { FileType } from '../../../domain/file';
import { FilePurpose } from '../../../domain/file-purpose';
import { FileVisibility } from '../../../domain/file-visibility';
import { FILE_PURPOSE_RULES, fileTooLargeError, mimeTypeFor } from '../../../file-purposes';
import { NullableType } from '../../../../../common/types/nullable.type';

@Injectable()
export class FilesLocalService {
  constructor(
    private readonly configService: ConfigService<AllConfigType>,
    private readonly fileRepository: FileRepository,
  ) {}

  async create(
    file: Express.Multer.File,
    ownerUserId: number,
    purpose: FilePurpose = FilePurpose.IMAGE,
  ): Promise<{ file: FileType }> {
    if (!file) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          file: 'selectFile',
        },
      });
    }

    if (file.size > this.configService.getOrThrow('file.maxSizes', { infer: true })[purpose]) {
      await unlink(file.path).catch(() => undefined);
      throw fileTooLargeError();
    }

    return {
      file: await this.fileRepository.create({
        path: this.publicPath(file.path),
        ownerUserId,
        visibility: FILE_PURPOSE_RULES[purpose].visibility,
        mimeType: mimeTypeFor(purpose, file.originalname),
        size: file.size,
      }),
    };
  }

  /** 私有文件视为不存在 */
  async findPublicByFileName(fileName: string): Promise<NullableType<FileType>> {
    const file = await this.fileRepository.findByPath(this.publicPath(`files/${fileName}`));
    return file?.visibility === FileVisibility.PUBLIC ? file : null;
  }

  private publicPath(diskPath: string): string {
    return `/${this.configService.get('app.apiPrefix', { infer: true })}/v1/${diskPath}`;
  }
}
