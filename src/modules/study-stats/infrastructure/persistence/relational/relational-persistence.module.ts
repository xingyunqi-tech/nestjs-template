import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StatsEventRepository } from '../stats-event.repository';
import { StatsEventRelationalRepository } from './repositories/stats-event.repository';
import { LearningStatsRepository } from '../learning-stats.repository';
import { LearningStatsRelationalRepository } from './repositories/learning-stats.repository';
import { CheckInRepository } from '../check-in.repository';
import { CheckInRelationalRepository } from './repositories/check-in.repository';
import { UserKnowledgeStatEntity } from './entities/user-knowledge-stat.entity';
import { UserDailyStatEntity } from './entities/user-daily-stat.entity';
import { StudyCheckinEntity } from './entities/study-checkin.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserKnowledgeStatEntity, UserDailyStatEntity, StudyCheckinEntity])],
  providers: [
    { provide: StatsEventRepository, useClass: StatsEventRelationalRepository },
    { provide: LearningStatsRepository, useClass: LearningStatsRelationalRepository },
    { provide: CheckInRepository, useClass: CheckInRelationalRepository },
  ],
  exports: [StatsEventRepository, LearningStatsRepository, CheckInRepository],
})
export class RelationalStudyStatsPersistenceModule {}
