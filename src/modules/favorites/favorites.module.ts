import { Module } from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { RelationalFavoritePersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';

@Module({
  imports: [RelationalFavoritePersistenceModule],
  providers: [FavoritesService],
  exports: [FavoritesService, RelationalFavoritePersistenceModule],
})
export class FavoritesModule {}
