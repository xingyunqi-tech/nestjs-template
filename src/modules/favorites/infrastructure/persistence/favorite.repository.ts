import { NullableType } from '../../../../common/types/nullable.type';
import { Favorite, FavoriteTargetType } from '../../domain/favorite';
import { IPaginationOptions } from '../../../../common/types/pagination-options';

export interface FavoriteFilter {
  userId: Favorite['userId'];
  targetType?: FavoriteTargetType;
  subjectId?: string;
}

export abstract class FavoriteRepository {
  abstract create(data: Omit<Favorite, 'id' | 'createdAt'>): Promise<Favorite>;

  abstract findManyWithPagination(
    filter: FavoriteFilter & { paginationOptions: IPaginationOptions },
  ): Promise<Favorite[]>;

  abstract findById(id: Favorite['id']): Promise<NullableType<Favorite>>;

  abstract findByUserAndTarget(
    userId: Favorite['userId'],
    targetType: FavoriteTargetType,
    targetId: string,
  ): Promise<NullableType<Favorite>>;

  /** targetIds 中已被该用户收藏的目标 */
  abstract findFavoritedTargetIds(
    userId: Favorite['userId'],
    targetType: FavoriteTargetType,
    targetIds: string[],
  ): Promise<string[]>;

  abstract remove(id: Favorite['id']): Promise<void>;

  abstract removeByUserAndTarget(
    userId: Favorite['userId'],
    targetType: FavoriteTargetType,
    targetId: string,
  ): Promise<void>;

  abstract count(filter: FavoriteFilter): Promise<number>;
}
