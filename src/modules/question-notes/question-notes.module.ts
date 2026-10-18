import { Module } from '@nestjs/common';
import { RelationalQuestionNotePersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { QuestionNotesService } from './question-notes.service';
import { QuestionNotesAccountCleaner } from './question-notes-account.cleaner';

@Module({
  imports: [RelationalQuestionNotePersistenceModule],
  providers: [QuestionNotesAccountCleaner, QuestionNotesService],
  exports: [QuestionNotesService],
})
export class QuestionNotesModule {}
