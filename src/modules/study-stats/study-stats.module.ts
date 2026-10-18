import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { RelationalStudyStatsPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { AppConfigModule } from '../config/config.module';
import { SchedulerModule } from '../../infrastructure/scheduler/scheduler.module';
import { isRedisEnabled } from '../../infrastructure/redis/config/redis.config';
import { STUDY_STATS_QUEUE } from '../../infrastructure/queue/study-stats-queue/study-stats-queue.constants';
import { StatsEventQueue } from './stats-event.queue';
import { StatsEventService } from './stats-event.service';
import { StatsCompensationTask } from './stats-compensation.task';
import { NoopWrongBookUpdater, WrongBookUpdater } from './ports/wrong-book.updater';
import { LearningStatsUpdater, NoopLearningStatsUpdater } from './ports/learning-stats.updater';
import { CheckInEvaluator, NoopCheckInEvaluator } from './ports/check-in.evaluator';

@Module({
  imports: [
    RelationalStudyStatsPersistenceModule,
    AppConfigModule,
    SchedulerModule,
    ConditionalModule.registerWhen(BullModule.registerQueue({ name: STUDY_STATS_QUEUE }), isRedisEnabled),
  ],
  providers: [
    StatsEventQueue,
    StatsEventService,
    StatsCompensationTask,
    { provide: WrongBookUpdater, useClass: NoopWrongBookUpdater },
    { provide: LearningStatsUpdater, useClass: NoopLearningStatsUpdater },
    { provide: CheckInEvaluator, useClass: NoopCheckInEvaluator },
  ],
  exports: [StatsEventQueue, StatsEventService],
})
export class StudyStatsModule {}
