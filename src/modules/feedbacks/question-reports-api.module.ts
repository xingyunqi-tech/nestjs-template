import { Module } from '@nestjs/common';
import { FeedbacksModule } from './feedbacks.module';
import { PracticeModule } from '../practice/practice.module';
import { QuestionsModule } from '../questions/questions.module';
import { ErrataModule } from '../errata/errata.module';
import { QuestionReportsService } from './question-reports.service';
import { QuestionReportsController } from './question-reports.controller';
import { AdminQuestionReportsController } from './admin-question-reports.controller';

@Module({
  imports: [FeedbacksModule, PracticeModule, QuestionsModule, ErrataModule],
  controllers: [QuestionReportsController, AdminQuestionReportsController],
  providers: [QuestionReportsService],
})
export class QuestionReportsApiModule {}
