import { Injectable } from '@nestjs/common';
import { WrongQuestionRepository } from './infrastructure/persistence/wrong-question.repository';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';

@AccountCleaner({ order: 30 })
@Injectable()
export class WrongBookAccountCleaner implements AccountDataCleaner {
  readonly name = 'wrong-book';

  constructor(private readonly wrongQuestionRepository: WrongQuestionRepository) {}

  clean(userId: number): Promise<void> {
    return this.wrongQuestionRepository.removeByUser(userId);
  }
}
