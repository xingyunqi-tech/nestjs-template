import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { FileRepository } from './infrastructure/persistence/file.repository';
import { FileType } from './domain/file';
import { FileVisibility } from './domain/file-visibility';
import { NullableType } from '../../common/types/nullable.type';

/**
 * 文件服务 - 管理文件元数据
 */
@Injectable()
export class FilesService {
  constructor(private readonly fileRepository: FileRepository) {}

  /**
   * 根据ID查找文件
   * @param id - 文件ID
   * @returns 文件对象或 null
   */
  findById(id: FileType['id']): Promise<NullableType<FileType>> {
    return this.fileRepository.findById(id);
  }

  /**
   * 根据ID列表批量查找文件
   * @param ids - 文件ID列表
   * @returns 文件对象列表
   */
  findByIds(ids: FileType['id'][]): Promise<FileType[]> {
    if (ids.length === 0) {
      return Promise.resolve([]);
    }
    return this.fileRepository.findByIds(ids);
  }

  canAccess(file: FileType, userId?: number | string | null): boolean {
    if (file.visibility !== FileVisibility.PRIVATE) {
      return true;
    }
    return userId !== undefined && userId !== null && file.ownerUserId === Number(userId);
  }

  /** 不存在时 404，无权访问时 403 */
  async findAccessible(id: FileType['id'], userId?: number | string | null): Promise<FileType> {
    const file = await this.fileRepository.findById(id);
    if (!file) {
      throw new NotFoundException({ error: 'fileNotFound' });
    }
    if (!this.canAccess(file, userId)) {
      throw new ForbiddenException({ error: 'fileNotAccessible' });
    }
    return file;
  }

  async assertReferenceable(ids: FileType['id'][], userId: number | string | null): Promise<FileType[]> {
    const uniqueIds = [...new Set(ids)];
    const files = await this.findByIds(uniqueIds);
    if (files.length !== uniqueIds.length) {
      throw new NotFoundException({ error: 'fileNotFound' });
    }
    if (files.some((file) => !this.canAccess(file, userId))) {
      throw new ForbiddenException({ error: 'fileNotAccessible' });
    }
    return files;
  }
}
