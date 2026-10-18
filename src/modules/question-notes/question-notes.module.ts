import { Module } from '@nestjs/common';
import { RelationalQuestionNotePersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { QuestionNotesService } from './question-notes.service';

@Module({
  imports: [RelationalQuestionNotePersistenceModule],
  providers: [QuestionNotesService],
  exports: [QuestionNotesService],
})
export class QuestionNotesModule {}
