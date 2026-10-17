import { FileType } from '../../../../domain/file';
import { FileVisibility } from '../../../../domain/file-visibility';
import { FileEntity } from '../entities/file.entity';

export class FileMapper {
  static toDomain(raw: FileEntity): FileType {
    const domainEntity = new FileType();
    domainEntity.id = raw.id;
    domainEntity.path = raw.path;
    domainEntity.ownerUserId = raw.ownerUserId ?? null;
    domainEntity.visibility = raw.visibility ?? FileVisibility.PUBLIC;
    domainEntity.mimeType = raw.mimeType ?? null;
    domainEntity.size = raw.size ?? null;
    domainEntity.sha256 = raw.sha256 ?? null;
    return domainEntity;
  }

  static toPersistence(domainEntity: FileType): FileEntity {
    const persistenceEntity = new FileEntity();
    persistenceEntity.id = domainEntity.id;
    persistenceEntity.path = domainEntity.path;
    persistenceEntity.ownerUserId = domainEntity.ownerUserId ?? null;
    persistenceEntity.visibility = domainEntity.visibility ?? FileVisibility.PUBLIC;
    persistenceEntity.mimeType = domainEntity.mimeType ?? null;
    persistenceEntity.size = domainEntity.size ?? null;
    persistenceEntity.sha256 = domainEntity.sha256 ?? null;
    return persistenceEntity;
  }
}
