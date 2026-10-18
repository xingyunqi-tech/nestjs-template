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
import { KnowledgeMasteryService } from '../study-stats/knowledge-mastery.service';
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
import { WrongBookReader } from './ports/wrong-book.reader';
import { WeakPointReader } from './ports/weak-point.reader';
import {
  CompositeQuestionAssociationReader,
  QUESTION_ASSOCIATION_SOURCES,
  QuestionAssociationReader,
  QuestionAssociationSource,
} from './ports/question-association.reader';
import { WrongBookModule } from '../wrong-book/wrong-book.module';
import { WrongBookService } from '../wrong-book/wrong-book.service';
import { FavoritesModule } from '../favorites/favorites.module';
import { FavoritesService } from '../favorites/favorites.service';
import { QuestionNotesModule } from '../question-notes/question-notes.module';
import { QuestionNotesService } from '../question-notes/question-notes.service';
import { QuestionAssociationPrerequisiteService } from './question-association-prerequisite.service';
import { AnswerRegradeService } from './answer-regrade.service';

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
    WrongBookModule,
    FavoritesModule,
    QuestionNotesModule,
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
    QuestionAssociationPrerequisiteService,
    AnswerRegradeService,
    AbandonInactiveSessionsTask,
    {
      provide: StatsEventPublisher,
      inject: [StatsEventQueue],
      useFactory: (queue: StatsEventQueue): StatsEventPublisher => queue,
    },
    {
      provide: WrongBookReader,
      inject: [WrongBookService],
      useFactory: (wrongBookService: WrongBookService): WrongBookReader => wrongBookService,
    },
    {
      provide: WeakPointReader,
      inject: [KnowledgeMasteryService],
      useFactory: (knowledgeMasteryService: KnowledgeMasteryService): WeakPointReader => knowledgeMasteryService,
    },
    {
      provide: QUESTION_ASSOCIATION_SOURCES,
      inject: [WrongBookService, FavoritesService, QuestionNotesService],
      useFactory: (
        wrongBookService: WrongBookService,
        favoritesService: FavoritesService,
        questionNotesService: QuestionNotesService,
      ): QuestionAssociationSource[] => [
        {
          findAssociatedQuestionIds: (userId, questionIds) =>
            wrongBookService.findQuestionIdsInBook(userId, questionIds),
        },
        {
          findAssociatedQuestionIds: (userId, questionIds) =>
            favoritesService.findFavoritedQuestionIds(userId, questionIds),
        },
        {
          findAssociatedQuestionIds: (userId, questionIds) =>
            questionNotesService.findQuestionIdsWithNote(userId, questionIds),
        },
      ],
    },
    { provide: QuestionAssociationReader, useClass: CompositeQuestionAssociationReader },
  ],
  exports: [
    PracticeSessionsService,
    MockExamService,
    AnswerVisibilityService,
    InProgressMockQuestionsService,
    QuestionAssociationPrerequisiteService,
    QuestionAccessService,
    AnswerRegradeService,
  ],
})
export class PracticeModule {}
