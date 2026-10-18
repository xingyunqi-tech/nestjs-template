import { HttpStatus, Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { FileRepository } from '../../persistence/file.repository';
import { FileType } from '../../../domain/file';
import { FilePurpose } from '../../../domain/file-purpose';
import { FILE_PURPOSE_RULES, fileOwnerFor, fileTooLargeError, mimeTypeFor } from '../../../file-purposes';
import { createS3Client } from '../../../config/s3-client.factory';
import { AllConfigType } from '../../../../../config/config.type';

@Injectable()
export class FilesS3Service {
  private readonly logger = new Logger(FilesS3Service.name);
  private readonly s3: S3Client;

  constructor(
    private readonly fileRepository: FileRepository,
    private readonly configService: ConfigService<AllConfigType>,
  ) {
    this.s3 = createS3Client(configService.getOrThrow('file', { infer: true }));
  }

  async create(
    file: Express.MulterS3.File,
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
      await this.s3.send(new DeleteObjectCommand({ Bucket: file.bucket, Key: file.key })).catch((error: unknown) => {
        this.logger.warn(`Failed to delete oversized upload ${file.key}: ${String(error)}`);
      });
      throw fileTooLargeError();
    }

    return {
      file: await this.fileRepository.create({
        path: file.key,
        ownerUserId: fileOwnerFor(purpose, ownerUserId),
        visibility: FILE_PURPOSE_RULES[purpose].visibility,
        mimeType: mimeTypeFor(purpose, file.originalname),
        size: file.size,
      }),
    };
  }
}
