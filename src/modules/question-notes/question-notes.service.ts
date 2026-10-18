import { Injectable, NotFoundException } from '@nestjs/common';
import { QuestionNoteFilter, QuestionNoteRepository } from './infrastructure/persistence/question-note.repository';
import { QuestionNote } from './domain/question-note';
import { IPaginationOptions } from '../../common/types/pagination-options';

@Injectable()
export class QuestionNotesService {
  constructor(private readonly questionNoteRepository: QuestionNoteRepository) {}

  save(userId: number, question: { id: string; subjectId: string }, content: string): Promise<QuestionNote> {
    return this.questionNoteRepository.upsert({
      userId,
      questionId: question.id,
      subjectId: question.subjectId,
      content,
    });
  }

  async remove(userId: number, questionId: string): Promise<void> {
    if (!(await this.questionNoteRepository.remove(userId, questionId))) {
      throw new NotFoundException({ error: 'questionNoteNotFound' });
    }
  }

  findManyWithPaginationAndCount(
    filter: QuestionNoteFilter,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: QuestionNote[]; total: number }> {
    return this.questionNoteRepository.findManyWithPaginationAndCount(filter, paginationOptions);
  }

  findQuestionIdsWithNote(userId: number, questionIds: string[]): Promise<string[]> {
    return this.questionNoteRepository.findQuestionIdsWithNote(userId, questionIds);
  }
}
