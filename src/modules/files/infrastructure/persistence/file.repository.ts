import { NullableType } from '../../../../common/types/nullable.type';
import { FileType } from '../../domain/file';

export abstract class FileRepository {
  abstract create(data: Omit<FileType, 'id'>): Promise<FileType>;

  abstract findById(id: FileType['id']): Promise<NullableType<FileType>>;

  abstract findByIds(ids: FileType['id'][]): Promise<FileType[]>;

  abstract findByPath(path: FileType['path']): Promise<NullableType<FileType>>;

  abstract findReusable(
    sha256: string,
    visibility: NonNullable<FileType['visibility']>,
    mimeType: string,
  ): Promise<NullableType<FileType>>;

  abstract remove(id: FileType['id']): Promise<void>;
}
