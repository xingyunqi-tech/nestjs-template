import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { RelationalPracticePersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ExamsModule } from '../exams/exams.module';
import { QuestionsModule } from '../questions/questions.module';
import { PapersModule } from '../papers/papers.module';
import { FilesModule } from '../files/files.module';
import { AppConfigModule } from '../config/config.module';
import { StudyStatsModule } from '../study-stats/study-stats.module';
import { StatsEventQueue } from '../study-stats/stats-event.queue';
import { SchedulerModule } from '../../infrastructure/scheduler/scheduler.module';
import { isRedisEnabled } from '../../infrastructure/redis/config/redis.config';
import { MOCK_SUBMIT_QUEUE } from '../../infrastructure/queue/mock-submit-queue/mock-submit-queue.constants';
import { PracticeSessionsService } from './practice-sessions.service';
import { PracticeAnswersService } from './practice-answers.service';
import { PracticeReportService } from './practice-report.service';
import { MockExamService } from './mock-exam.service';
import { MockSubmitScheduler } from './mock-submit.scheduler';
import { AutoSubmitMockSessionsTask } from './auto-submit-mock-sessions.task';
import { QuestionPickerService } from './question-picker.service';
import { AnswerVisibilityService } from './answer-visibility.service';
import { InProgressMockQuestionsService } from './in-progress-mock-questions.service';
import { QuestionAccessService } from './question-access.service';
import { AbandonInactiveSessionsTask } from './abandon-inactive-sessions.task';
import { PracticeSessionsController } from './practice-sessions.controller';
import { QuestionAccessController } from './question-access.controller';
import { StatsEventPublisher } from './ports/stats-event.publisher';
import { EmptyWrongBookReader, WrongBookReader } from './ports/wrong-book.reader';
import { EmptyWeakPointReader, WeakPointReader } from './ports/weak-point.reader';
import { EmptyQuestionAssociationReader, QuestionAssociationReader } from './ports/question-association.reader';

@Module({
  imports: [
    RelationalPracticePersistenceModule,
    ExamsModule,
    QuestionsModule,
    PapersModule,
    FilesModule,
    AppConfigModule,
    SchedulerModule,
    StudyStatsModule,
    ConditionalModule.registerWhen(BullModule.registerQueue({ name: MOCK_SUBMIT_QUEUE }), isRedisEnabled),
  ],
  controllers: [PracticeSessionsController, QuestionAccessController],
  providers: [
    PracticeSessionsService,
    PracticeAnswersService,
    PracticeReportService,
    MockExamService,
    MockSubmitScheduler,
    AutoSubmitMockSessionsTask,
    QuestionPickerService,
    AnswerVisibilityService,
    InProgressMockQuestionsService,
    QuestionAccessService,
    AbandonInactiveSessionsTask,
    {
      provide: StatsEventPublisher,
      inject: [StatsEventQueue],
      useFactory: (queue: StatsEventQueue): StatsEventPublisher => queue,
    },
    { provide: WrongBookReader, useClass: EmptyWrongBookReader },
    { provide: WeakPointReader, useClass: EmptyWeakPointReader },
    { provide: QuestionAssociationReader, useClass: EmptyQuestionAssociationReader },
  ],
  exports: [PracticeSessionsService, MockExamService, AnswerVisibilityService, InProgressMockQuestionsService],
})
export class PracticeModule {}
