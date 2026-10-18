import { HttpStatus, Injectable, UnprocessableEntityException } from '@nestjs/common';
import { FileRepository } from '../../persistence/file.repository';

import { FileUploadDto } from './dto/file.dto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createS3Client } from '../../../config/s3-client.factory';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { ConfigService } from '@nestjs/config';
import { FileType } from '../../../domain/file';
import { FilePurpose } from '../../../domain/file-purpose';
import { FILE_PURPOSE_RULES, fileOwnerFor, fileTooLargeError, fileTypeNotAllowedError, mimeTypeFor } from '../../../file-purposes';
import { AllConfigType } from '../../../../../config/config.type';

@Injectable()
export class FilesS3PresignedService {
  private s3: S3Client;

  constructor(
    private readonly fileRepository: FileRepository,
    private readonly configService: ConfigService<AllConfigType>,
  ) {
    this.s3 = createS3Client(configService.getOrThrow('file', { infer: true }));
  }

  async create(
    file: FileUploadDto,
    ownerUserId: number,
    purpose: FilePurpose = FilePurpose.IMAGE,
  ): Promise<{ file: FileType; uploadSignedUrl: string }> {
    if (!file) {
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          file: 'selectFile',
        },
      });
    }

    const mimeType = mimeTypeFor(purpose, file.fileName);
    if (!mimeType) {
      throw fileTypeNotAllowedError();
    }

    if (file.fileSize > this.configService.getOrThrow('file.maxSizes', { infer: true })[purpose]) {
      throw fileTooLargeError();
    }

    const key = `${randomStringGenerator()}.${file.fileName.split('.').pop()?.toLowerCase()}`;

    const command = new PutObjectCommand({
      Bucket: this.configService.getOrThrow('file.awsDefaultS3Bucket', {
        infer: true,
      }),
      Key: key,
      ContentLength: file.fileSize,
    });
    const signedUrl = await getSignedUrl(this.s3, command, { expiresIn: 3600 });
    const data = await this.fileRepository.create({
      path: key,
      ownerUserId: fileOwnerFor(purpose, ownerUserId),
      visibility: FILE_PURPOSE_RULES[purpose].visibility,
      mimeType,
      size: file.fileSize,
    });

    return {
      file: data,
      uploadSignedUrl: signedUrl,
    };
  }
}
