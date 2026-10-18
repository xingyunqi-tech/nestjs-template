import { Favorite } from '../../../../domain/favorite';
import { FavoriteEntity } from '../entities/favorite.entity';

export class FavoriteMapper {
  static toDomain(raw: FavoriteEntity): Favorite {
    const domainEntity = new Favorite();
    domainEntity.id = raw.id;
    domainEntity.userId = raw.userId;
    domainEntity.targetType = raw.targetType;
    domainEntity.targetId = raw.targetId;
    domainEntity.title = raw.title;
    domainEntity.image = raw.image;
    domainEntity.extra = raw.extra;
    domainEntity.subjectId = raw.subjectId;
    domainEntity.createdAt = raw.createdAt;
    return domainEntity;
  }

  static toPersistence(domainEntity: Omit<Favorite, 'id' | 'createdAt'>): FavoriteEntity {
    const persistenceEntity = new FavoriteEntity();
    persistenceEntity.userId = Number(domainEntity.userId);
    persistenceEntity.targetType = domainEntity.targetType;
    persistenceEntity.targetId = domainEntity.targetId;
    persistenceEntity.title = domainEntity.title;
    persistenceEntity.image = domainEntity.image;
    persistenceEntity.extra = domainEntity.extra;
    persistenceEntity.subjectId = domainEntity.subjectId;
    return persistenceEntity;
  }
}
