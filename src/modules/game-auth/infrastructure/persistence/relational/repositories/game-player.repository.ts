import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GamePlayerEntity } from '../entities/game-player.entity';
import { GamePlayerRepository } from '../../game-player.repository';
import { GamePlayerMapper } from '../mappers/game-player.mapper';
import { GamePlatform, GamePlayer } from '../../../../domain/game-player';
import { NullableType } from '../../../../../../common/types/nullable.type';

@Injectable()
export class GamePlayerRelationalRepository implements GamePlayerRepository {
  constructor(
    @InjectRepository(GamePlayerEntity)
    private readonly gamePlayerRepository: Repository<GamePlayerEntity>,
  ) {}

  async upsertLogin(data: {
    platform: GamePlatform;
    openId: string;
    unionId: string | null;
    refreshHash: string;
  }): Promise<GamePlayer> {
    const persistenceModel = GamePlayerMapper.toPersistence({ ...data, lastLoginAt: new Date() });
    await this.gamePlayerRepository.upsert(persistenceModel, { conflictPaths: ['platform', 'openId'] });
    const entity = await this.gamePlayerRepository.findOneOrFail({
      where: { platform: data.platform, openId: data.openId },
    });
    return GamePlayerMapper.toDomain(entity);
  }

  async findById(id: GamePlayer['id']): Promise<NullableType<GamePlayer>> {
    const entity = await this.gamePlayerRepository.findOne({ where: { id: Number(id) } });
    return entity ? GamePlayerMapper.toDomain(entity) : null;
  }

  async rotateRefreshHash(id: GamePlayer['id'], from: string, to: string): Promise<boolean> {
    const result = await this.gamePlayerRepository.update({ id: Number(id), refreshHash: from }, { refreshHash: to });
    return (result.affected ?? 0) > 0;
  }
}
