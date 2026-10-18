import { NullableType } from '../../../../common/types/nullable.type';
import { FileType } from '../../domain/file';

export abstract class FileRepository {
  abstract create(data: Omit<FileType, 'id'>): Promise<FileType>;

  abstract findById(id: FileType['id']): Promise<NullableType<FileType>>;

  abstract findByIds(ids: FileType['id'][]): Promise<FileType[]>;

  abstract findByPath(path: FileType['path']): Promise<NullableType<FileType>>;

  /** 仅匹配无主文件 */
  abstract findReusable(
    sha256: string,
    visibility: NonNullable<FileType['visibility']>,
    mimeType: string,
  ): Promise<NullableType<FileType>>;

  abstract remove(id: FileType['id']): Promise<void>;

  /** 事务内删除记录后执行 afterDelete，afterDelete 失败时回滚 */
  abstract removeWithin(id: FileType['id'], afterDelete: () => Promise<void>): Promise<void>;

  /** 该用户上传的文件，按 id 升序取 afterId 之后的 limit 条 */
  abstract findByOwner(ownerUserId: number, afterId: FileType['id'] | null, limit: number): Promise<FileType[]>;
}
