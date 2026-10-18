import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { StudyStatsQueueProcessor } from './study-stats-queue.processor';
import { STUDY_STATS_QUEUE } from './study-stats-queue.constants';
import { StudyStatsModule } from '../../../modules/study-stats/study-stats.module';

@Module({
  imports: [BullModule.registerQueue({ name: STUDY_STATS_QUEUE }), StudyStatsModule],
  providers: [StudyStatsQueueProcessor],
  exports: [StudyStatsQueueProcessor],
})
export class StudyStatsQueueModule {}
