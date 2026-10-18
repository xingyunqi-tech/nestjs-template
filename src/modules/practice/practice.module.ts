import { Module } from '@nestjs/common';
import { RelationalPracticePersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ExamsModule } from '../exams/exams.module';
import { QuestionsModule } from '../questions/questions.module';
import { PapersModule } from '../papers/papers.module';
import { FilesModule } from '../files/files.module';
import { SchedulerModule } from '../../infrastructure/scheduler/scheduler.module';
import { PracticeSessionsService } from './practice-sessions.service';
import { PracticeAnswersService } from './practice-answers.service';
import { QuestionPickerService } from './question-picker.service';
import { AnswerVisibilityService } from './answer-visibility.service';
import { InProgressMockQuestionsService } from './in-progress-mock-questions.service';
import { QuestionAccessService } from './question-access.service';
import { AbandonInactiveSessionsTask } from './abandon-inactive-sessions.task';
import { PracticeSessionsController } from './practice-sessions.controller';
import { QuestionAccessController } from './question-access.controller';
import { NoopStatsEventPublisher, StatsEventPublisher } from './ports/stats-event.publisher';
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
    SchedulerModule,
  ],
  controllers: [PracticeSessionsController, QuestionAccessController],
  providers: [
    PracticeSessionsService,
    PracticeAnswersService,
    QuestionPickerService,
    AnswerVisibilityService,
    InProgressMockQuestionsService,
    QuestionAccessService,
    AbandonInactiveSessionsTask,
    { provide: StatsEventPublisher, useClass: NoopStatsEventPublisher },
    { provide: WrongBookReader, useClass: EmptyWrongBookReader },
    { provide: WeakPointReader, useClass: EmptyWeakPointReader },
    { provide: QuestionAssociationReader, useClass: EmptyQuestionAssociationReader },
  ],
  exports: [PracticeSessionsService, AnswerVisibilityService, InProgressMockQuestionsService],
})
export class PracticeModule {}
