import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GamePlayerEntity } from './entities/game-player.entity';
import { GamePlayerRepository } from '../game-player.repository';
import { GamePlayerRelationalRepository } from './repositories/game-player.repository';

@Module({
  imports: [TypeOrmModule.forFeature([GamePlayerEntity])],
  providers: [
    {
      provide: GamePlayerRepository,
      useClass: GamePlayerRelationalRepository,
    },
  ],
  exports: [GamePlayerRepository],
})
export class RelationalGamePlayerPersistenceModule {}
