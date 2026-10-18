import { Module } from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { RelationalFavoritePersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { FavoritesAccountCleaner } from './favorites-account.cleaner';

@Module({
  imports: [RelationalFavoritePersistenceModule],
  providers: [FavoritesAccountCleaner, FavoritesService],
  exports: [FavoritesService, RelationalFavoritePersistenceModule],
})
export class FavoritesModule {}
