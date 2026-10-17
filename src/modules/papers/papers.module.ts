import { Module } from '@nestjs/common';
import { RelationalPaperPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ExamsModule } from '../exams/exams.module';
import { QuestionsModule } from '../questions/questions.module';
import { AppConfigModule } from '../config/config.module';
import { SchedulerModule } from '../../infrastructure/scheduler/scheduler.module';
import { PapersService } from './papers.service';
import { PaperRulesService } from './paper-rules.service';
import { DailyQuestionSetsService } from './daily-question-sets.service';
import { GenerateDailyQuestionSetsTask } from './generate-daily-question-sets.task';
import { PapersController } from './papers.controller';
import { AdminPapersController } from './admin-papers.controller';
import { AdminPaperRulesController } from './admin-paper-rules.controller';
import { AdminDailyQuestionSetsController } from './admin-daily-question-sets.controller';

@Module({
  imports: [RelationalPaperPersistenceModule, ExamsModule, QuestionsModule, AppConfigModule, SchedulerModule],
  controllers: [PapersController, AdminPapersController, AdminPaperRulesController, AdminDailyQuestionSetsController],
  providers: [PapersService, PaperRulesService, DailyQuestionSetsService, GenerateDailyQuestionSetsTask],
  exports: [PapersService, PaperRulesService, DailyQuestionSetsService, RelationalPaperPersistenceModule],
})
export class PapersModule {}
