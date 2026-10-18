import { Module } from '@nestjs/common';
import { StatsEventRepository } from '../stats-event.repository';
import { StatsEventRelationalRepository } from './repositories/stats-event.repository';

@Module({
  providers: [{ provide: StatsEventRepository, useClass: StatsEventRelationalRepository }],
  exports: [StatsEventRepository],
})
export class RelationalStudyStatsPersistenceModule {}
