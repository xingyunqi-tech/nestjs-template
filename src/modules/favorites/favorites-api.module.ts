import { Module } from '@nestjs/common';
import { FavoritesModule } from './favorites.module';
import { FavoritesController } from './favorites.controller';
import { FavoriteTargetsService } from './favorite-targets.service';
import { PracticeModule } from '../practice/practice.module';
import { PapersModule } from '../papers/papers.module';
import { QuestionsModule } from '../questions/questions.module';

@Module({
  imports: [FavoritesModule, PracticeModule, PapersModule, QuestionsModule],
  controllers: [FavoritesController],
  providers: [FavoriteTargetsService],
})
export class FavoritesApiModule {}
