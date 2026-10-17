import { Module } from '@nestjs/common';
import { RelationalQuestionPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ExamsModule } from '../exams/exams.module';
import { FilesModule } from '../files/files.module';
import { QuestionsService } from './questions.service';
import { AdminQuestionsController } from './admin-questions.controller';

@Module({
  imports: [RelationalQuestionPersistenceModule, ExamsModule, FilesModule],
  controllers: [AdminQuestionsController],
  providers: [QuestionsService],
  exports: [QuestionsService, RelationalQuestionPersistenceModule],
})
export class QuestionsModule {}
