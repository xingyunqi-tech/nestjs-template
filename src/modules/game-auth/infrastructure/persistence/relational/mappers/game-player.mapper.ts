import { GamePlayer } from '../../../../domain/game-player';
import { GamePlayerEntity } from '../entities/game-player.entity';

export class GamePlayerMapper {
  static toDomain(raw: GamePlayerEntity): GamePlayer {
    const domainEntity = new GamePlayer();
    domainEntity.id = raw.id;
    domainEntity.platform = raw.platform;
    domainEntity.openId = raw.openId;
    domainEntity.unionId = raw.unionId;
    domainEntity.refreshHash = raw.refreshHash;
    domainEntity.lastLoginAt = raw.lastLoginAt;
    domainEntity.createdAt = raw.createdAt;
    return domainEntity;
  }

  static toPersistence(domainEntity: Omit<GamePlayer, 'id' | 'createdAt'>): GamePlayerEntity {
    const persistenceEntity = new GamePlayerEntity();
    persistenceEntity.platform = domainEntity.platform;
    persistenceEntity.openId = domainEntity.openId;
    persistenceEntity.unionId = domainEntity.unionId;
    persistenceEntity.refreshHash = domainEntity.refreshHash;
    persistenceEntity.lastLoginAt = domainEntity.lastLoginAt;
    return persistenceEntity;
  }
}
