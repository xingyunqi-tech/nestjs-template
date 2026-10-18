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
import { WrongBookUpdater } from './ports/wrong-book.updater';
import { WrongBookModule } from '../wrong-book/wrong-book.module';
import { WrongBookService } from '../wrong-book/wrong-book.service';
import { LearningStatsUpdater } from './ports/learning-stats.updater';
import { CheckInEvaluator } from './ports/check-in.evaluator';
import { LearningStatsService } from './learning-stats.service';
import { CheckInService } from './check-in.service';
import { KnowledgeMasteryService } from './knowledge-mastery.service';

@Module({
  imports: [
    RelationalStudyStatsPersistenceModule,
    AppConfigModule,
    SchedulerModule,
    WrongBookModule,
    ConditionalModule.registerWhen(BullModule.registerQueue({ name: STUDY_STATS_QUEUE }), isRedisEnabled),
  ],
  providers: [
    StatsEventQueue,
    StatsEventService,
    StatsCompensationTask,
    {
      provide: WrongBookUpdater,
      inject: [WrongBookService],
      useFactory: (wrongBookService: WrongBookService): WrongBookUpdater => ({
        apply: (handle, record) => wrongBookService.applyStatsRecord(handle, record),
      }),
    },
    LearningStatsService,
    CheckInService,
    KnowledgeMasteryService,
    { provide: LearningStatsUpdater, useExisting: LearningStatsService },
    { provide: CheckInEvaluator, useExisting: CheckInService },
  ],
  exports: [StatsEventQueue, StatsEventService, LearningStatsService, CheckInService, KnowledgeMasteryService],
})
export class StudyStatsModule {}
