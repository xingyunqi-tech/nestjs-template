import { Injectable } from '@nestjs/common';
import { FeedbackRepository } from './infrastructure/persistence/feedback.repository';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';

@AccountCleaner({ order: 90 })
@Injectable()
export class FeedbacksAccountCleaner implements AccountDataCleaner {
  readonly name = 'feedbacks';

  constructor(private readonly feedbackRepository: FeedbackRepository) {}

  clean(userId: number): Promise<void> {
    return this.feedbackRepository.anonymizeByUser(userId);
  }
}
