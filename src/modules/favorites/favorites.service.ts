import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { FavoriteFilter, FavoriteRepository } from './infrastructure/persistence/favorite.repository';
import { Favorite, FavoriteTargetType, normalizeTargetId } from './domain/favorite';
import { IPaginationOptions } from '../../common/types/pagination-options';
import { NullableType } from '../../common/types/nullable.type';
import { CheckFavoriteResponseDto } from './dto/check-favorite.dto';

export type FavoriteInput = Omit<Favorite, 'id' | 'createdAt' | 'userId'>;

@Injectable()
export class FavoritesService {
  private readonly logger = new Logger(FavoritesService.name);

  constructor(private readonly favoriteRepository: FavoriteRepository) {}

  async create(userId: number, input: FavoriteInput): Promise<Favorite> {
    this.logger.log(`Creating favorite for user: ${userId}, target: ${input.targetType}:${input.targetId}`);

    const existing = await this.findByTarget(userId, input.targetType, input.targetId);

    if (existing) {
      this.logger.warn(`Already favorited: ${input.targetType}:${input.targetId}`);
      throw new ConflictException({
        error: 'alreadyFavorited',
      });
    }

    const favorite = await this.favoriteRepository.create({
      ...input,
      targetId: normalizeTargetId(input.targetType, input.targetId),
      userId,
    });

    this.logger.log(`Favorite created: ${favorite.id}`);
    return favorite;
  }

  async findManyWithPagination({
    paginationOptions,
    ...filter
  }: FavoriteFilter & { paginationOptions: IPaginationOptions }): Promise<Favorite[]> {
    return this.favoriteRepository.findManyWithPagination({ ...filter, paginationOptions });
  }

  async findManyWithPaginationAndCount({
    paginationOptions,
    ...filter
  }: FavoriteFilter & { paginationOptions: IPaginationOptions }): Promise<{ data: Favorite[]; total: number }> {
    const [data, total] = await Promise.all([
      this.favoriteRepository.findManyWithPagination({ ...filter, paginationOptions }),
      this.favoriteRepository.count(filter),
    ]);
    return { data, total };
  }

  findByTarget(userId: number, targetType: FavoriteTargetType, targetId: string): Promise<NullableType<Favorite>> {
    return this.favoriteRepository.findByUserAndTarget(userId, targetType, normalizeTargetId(targetType, targetId));
  }

  async check(userId: number, targetType: FavoriteTargetType, targetId: string): Promise<CheckFavoriteResponseDto> {
    const favorite = await this.findByTarget(userId, targetType, targetId);
    return {
      isFavorited: !!favorite,
      favoriteId: favorite?.id,
    };
  }

  findFavoritedQuestionIds(userId: number, questionIds: string[]): Promise<string[]> {
    return this.favoriteRepository.findFavoritedTargetIds(userId, FavoriteTargetType.QUESTION, questionIds);
  }

  async remove(id: Favorite['id'], userId: Favorite['userId']): Promise<void> {
    this.logger.log(`Removing favorite: ${id} for user: ${userId}`);

    const favorite = await this.favoriteRepository.findById(id);
    if (favorite?.userId.toString() !== userId.toString()) {
      this.logger.warn(`Favorite ${id} not found or not owned by user ${userId}`);
      throw new NotFoundException({
        error: 'favoriteNotFound',
      });
    }

    await this.favoriteRepository.remove(id);
    this.logger.log(`Favorite removed: ${id}`);
  }

  async countByUserId(userId: Favorite['userId'], targetType?: FavoriteTargetType): Promise<number> {
    return this.favoriteRepository.count({ userId, targetType });
  }
}
