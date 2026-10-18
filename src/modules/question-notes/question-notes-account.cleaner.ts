import { Injectable } from '@nestjs/common';
import { QuestionNoteRepository } from './infrastructure/persistence/question-note.repository';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';

@AccountCleaner({ order: 60 })
@Injectable()
export class QuestionNotesAccountCleaner implements AccountDataCleaner {
  readonly name = 'question-notes';

  constructor(private readonly questionNoteRepository: QuestionNoteRepository) {}

  clean(userId: number): Promise<void> {
    return this.questionNoteRepository.removeByUser(userId);
  }
}
