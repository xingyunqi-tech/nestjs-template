import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QuestionNoteEntity } from './entities/question-note.entity';
import { QuestionNoteRepository } from '../question-note.repository';
import { QuestionNoteRelationalRepository } from './repositories/question-note.repository';

@Module({
  imports: [TypeOrmModule.forFeature([QuestionNoteEntity])],
  providers: [{ provide: QuestionNoteRepository, useClass: QuestionNoteRelationalRepository }],
  exports: [QuestionNoteRepository],
})
export class RelationalQuestionNotePersistenceModule {}
