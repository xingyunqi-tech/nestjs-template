import { Injectable } from '@nestjs/common';
import { FavoriteRepository } from './infrastructure/persistence/favorite.repository';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';

@AccountCleaner({ order: 70 })
@Injectable()
export class FavoritesAccountCleaner implements AccountDataCleaner {
  readonly name = 'favorites';

  constructor(private readonly favoriteRepository: FavoriteRepository) {}

  clean(userId: number): Promise<void> {
    return this.favoriteRepository.removeByUser(userId);
  }
}
