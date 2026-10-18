import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, Repository } from 'typeorm';
import { FavoriteEntity } from '../entities/favorite.entity';
import { FavoriteFilter, FavoriteRepository } from '../../favorite.repository';
import { FavoriteMapper } from '../mappers/favorite.mapper';
import { Favorite, FavoriteTargetType } from '../../../../domain/favorite';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';

function whereOf({ userId, targetType, subjectId }: FavoriteFilter): FindOptionsWhere<FavoriteEntity> {
  return {
    userId: Number(userId),
    ...(targetType && { targetType }),
    ...(subjectId && { subjectId }),
  };
}

@Injectable()
export class FavoriteRelationalRepository implements FavoriteRepository {
  constructor(
    @InjectRepository(FavoriteEntity)
    private readonly favoriteRepository: Repository<FavoriteEntity>,
  ) {}

  async create(data: Omit<Favorite, 'id' | 'createdAt'>): Promise<Favorite> {
    const persistenceModel = FavoriteMapper.toPersistence(data);
    const newEntity = await this.favoriteRepository.save(this.favoriteRepository.create(persistenceModel));
    return FavoriteMapper.toDomain(newEntity);
  }

  async findManyWithPagination({
    paginationOptions,
    ...filter
  }: FavoriteFilter & { paginationOptions: IPaginationOptions }): Promise<Favorite[]> {
    const entities = await this.favoriteRepository.find({
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
      where: whereOf(filter),
      order: { createdAt: 'DESC' },
    });

    return entities.map((entity) => FavoriteMapper.toDomain(entity));
  }

  async findById(id: Favorite['id']): Promise<NullableType<Favorite>> {
    const entity = await this.favoriteRepository.findOne({
      where: { id: Number(id) },
    });
    return entity ? FavoriteMapper.toDomain(entity) : null;
  }

  async findByUserAndTarget(
    userId: Favorite['userId'],
    targetType: FavoriteTargetType,
    targetId: string,
  ): Promise<NullableType<Favorite>> {
    const entity = await this.favoriteRepository.findOne({
      where: {
        userId: Number(userId),
        targetType,
        targetId,
      },
    });
    return entity ? FavoriteMapper.toDomain(entity) : null;
  }

  async findFavoritedTargetIds(
    userId: Favorite['userId'],
    targetType: FavoriteTargetType,
    targetIds: string[],
  ): Promise<string[]> {
    if (targetIds.length === 0) {
      return [];
    }
    const entities = await this.favoriteRepository.find({
      select: { targetId: true },
      where: { userId: Number(userId), targetType, targetId: In(targetIds) },
    });
    return entities.map((entity) => entity.targetId);
  }

  async remove(id: Favorite['id']): Promise<void> {
    await this.favoriteRepository.delete(id);
  }

  async removeByUserAndTarget(
    userId: Favorite['userId'],
    targetType: FavoriteTargetType,
    targetId: string,
  ): Promise<void> {
    await this.favoriteRepository.delete({
      userId: Number(userId),
      targetType,
      targetId,
    });
  }

  async count(filter: FavoriteFilter): Promise<number> {
    return this.favoriteRepository.count({ where: whereOf(filter) });
  }
}
