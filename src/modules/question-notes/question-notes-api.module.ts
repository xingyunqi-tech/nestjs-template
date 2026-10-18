import { Module } from '@nestjs/common';
import { QuestionNotesModule } from './question-notes.module';
import { QuestionNotesController } from './question-notes.controller';
import { QuestionNotesBrowseService } from './question-notes-browse.service';
import { PracticeModule } from '../practice/practice.module';
import { QuestionsModule } from '../questions/questions.module';

@Module({
  imports: [QuestionNotesModule, PracticeModule, QuestionsModule],
  controllers: [QuestionNotesController],
  providers: [QuestionNotesBrowseService],
})
export class QuestionNotesApiModule {}
