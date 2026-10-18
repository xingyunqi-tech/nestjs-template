import { Injectable, Logger } from '@nestjs/common';
import { FileRepository } from './infrastructure/persistence/file.repository';
import { FileStorageService } from './file-storage.service';
import { FileType } from './domain/file';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';
import { isForeignKeyViolation } from '../../common/utils/exceptions.util';

const BATCH_SIZE = 100;

/** 删除该用户上传的文件与存储对象；仍被外键引用的文件保留 */
@AccountCleaner({ order: 1000 })
@Injectable()
export class FilesAccountCleaner implements AccountDataCleaner {
  readonly name = 'files';

  private readonly logger = new Logger(FilesAccountCleaner.name);

  constructor(
    private readonly fileRepository: FileRepository,
    private readonly fileStorageService: FileStorageService,
  ) {}

  async clean(userId: number): Promise<void> {
    let afterId: FileType['id'] | null = null;
    for (;;) {
      const files = await this.fileRepository.findByOwner(userId, afterId, BATCH_SIZE);
      for (const file of files) {
        await this.remove(file);
      }
      if (files.length < BATCH_SIZE) {
        return;
      }
      afterId = files[files.length - 1].id;
    }
  }

  private async remove(file: FileType): Promise<void> {
    try {
      await this.fileStorageService.remove(file);
    } catch (error) {
      if (!isForeignKeyViolation(error)) {
        throw error;
      }
      this.logger.warn(`File ${file.id} is still referenced and kept`);
    }
  }
}
