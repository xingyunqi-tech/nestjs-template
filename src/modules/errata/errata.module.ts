import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { RelationalErrataPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { QuestionsModule } from '../questions/questions.module';
import { PapersModule } from '../papers/papers.module';
import { PracticeModule } from '../practice/practice.module';
import { StudyStatsModule } from '../study-stats/study-stats.module';
import { WrongBookModule } from '../wrong-book/wrong-book.module';
import { FeedbacksModule } from '../feedbacks/feedbacks.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { isRedisEnabled } from '../../infrastructure/redis/config/redis.config';
import { ERRATA_QUEUE } from '../../infrastructure/queue/errata-queue/errata-queue.constants';
import { ErrataService } from './errata.service';
import { ErrataQueue } from './errata.queue';
import { AdminErrataController } from './admin-errata.controller';
import { ErrataWatchdogTask } from './errata-watchdog.task';
import { SchedulerModule } from '../../infrastructure/scheduler/scheduler.module';
import { ErrataAccountCleaner } from './errata-account.cleaner';

@Module({
  imports: [
    RelationalErrataPersistenceModule,
    QuestionsModule,
    PapersModule,
    PracticeModule,
    StudyStatsModule,
    WrongBookModule,
    FeedbacksModule,
    NotificationsModule,
    SchedulerModule,
    ConditionalModule.registerWhen(BullModule.registerQueue({ name: ERRATA_QUEUE }), isRedisEnabled),
  ],
  controllers: [AdminErrataController],
  providers: [ErrataService, ErrataQueue, ErrataWatchdogTask, ErrataAccountCleaner],
  exports: [ErrataService, RelationalErrataPersistenceModule],
})
export class ErrataModule {}
