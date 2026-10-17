import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';
import { FileRepository } from './infrastructure/persistence/file.repository';
import { FileType } from './domain/file';
import { FilePurpose } from './domain/file-purpose';
import { FileVisibility } from './domain/file-visibility';
import { FileDriver } from './config/file-config.type';
import { createS3Client } from './config/s3-client.factory';
import { FILE_PURPOSE_RULES, fileExtension, fileTooLargeError, fileTypeNotAllowedError, mimeTypeFor } from './file-purposes';
import { LOCAL_FILES_ROOT, localDiskPath, localFileUrlPath } from './local-file-path';
import { AllConfigType } from '../../config/config.type';

export interface StoredFile {
  file: FileType;
  reused: boolean;
}

function sha256Of(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** 服务端直接读写文件内容，与上传接口使用相同的存储位置与用途规则 */
@Injectable()
export class FileStorageService {
  private s3?: S3Client;

  constructor(
    private readonly fileRepository: FileRepository,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async store(
    content: Buffer,
    fileName: string,
    purpose: FilePurpose,
    ownerUserId: number | null,
  ): Promise<FileType> {
    const mimeType = this.assertStorable(content, fileName, purpose);
    return this.write(content, fileName, purpose, mimeType, ownerUserId);
  }

  /** 公共用途下已有相同内容与类型的文件时复用，不再写入 */
  async storeDeduplicated(
    content: Buffer,
    fileName: string,
    purpose: FilePurpose,
    ownerUserId: number | null,
  ): Promise<StoredFile> {
    const mimeType = this.assertStorable(content, fileName, purpose);
    if (FILE_PURPOSE_RULES[purpose].visibility === FileVisibility.PUBLIC) {
      const existing = await this.fileRepository.findReusable(sha256Of(content), FileVisibility.PUBLIC, mimeType);
      if (existing) {
        return { file: existing, reused: true };
      }
    }
    return { file: await this.write(content, fileName, purpose, mimeType, ownerUserId), reused: false };
  }

  async read(file: FileType): Promise<Buffer> {
    if (this.isLocal()) {
      return readFile(localDiskPath(file.path));
    }
    const output = await this.client().send(new GetObjectCommand({ Bucket: this.bucket(), Key: file.path }));
    if (!output.Body) {
      throw new Error(`Object ${file.path} has no body`);
    }
    return Buffer.from(await output.Body.transformToByteArray());
  }

  async remove(file: FileType): Promise<void> {
    await this.fileRepository.remove(file.id);
    if (this.isLocal()) {
      await unlink(localDiskPath(file.path)).catch(() => undefined);
    } else {
      await this.client().send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: file.path }));
    }
  }

  private assertStorable(content: Buffer, fileName: string, purpose: FilePurpose): string {
    const mimeType = mimeTypeFor(purpose, fileName);
    if (!mimeType) {
      throw fileTypeNotAllowedError();
    }
    if (content.length > this.configService.getOrThrow('file.maxSizes', { infer: true })[purpose]) {
      throw fileTooLargeError();
    }
    return mimeType;
  }

  private async write(
    content: Buffer,
    fileName: string,
    purpose: FilePurpose,
    mimeType: string,
    ownerUserId: number | null,
  ): Promise<FileType> {
    const key = `${randomStringGenerator()}.${fileExtension(fileName)}`;
    let path = key;
    if (this.isLocal()) {
      await mkdir(LOCAL_FILES_ROOT, { recursive: true });
      await writeFile(join(LOCAL_FILES_ROOT, key), content);
      path = localFileUrlPath(this.configService.get('app.apiPrefix', { infer: true }), key);
    } else {
      await this.client().send(
        new PutObjectCommand({ Bucket: this.bucket(), Key: key, Body: content, ContentType: mimeType }),
      );
    }
    return this.fileRepository.create({
      path,
      ownerUserId,
      visibility: FILE_PURPOSE_RULES[purpose].visibility,
      mimeType,
      size: content.length,
      sha256: sha256Of(content),
    });
  }

  private isLocal(): boolean {
    return this.configService.get('file.driver', { infer: true }) === FileDriver.LOCAL;
  }

  private bucket(): string {
    return this.configService.getOrThrow('file.awsDefaultS3Bucket', { infer: true });
  }

  private client(): S3Client {
    this.s3 ??= createS3Client(this.configService.getOrThrow('file', { infer: true }));
    return this.s3;
  }
}
