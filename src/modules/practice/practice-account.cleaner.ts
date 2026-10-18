import { Injectable } from '@nestjs/common';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { MockSubmitScheduler } from './mock-submit.scheduler';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';

@AccountCleaner({ order: 10 })
@Injectable()
export class PracticeAccountCleaner implements AccountDataCleaner {
  readonly name = 'practice';

  constructor(
    private readonly practiceSessionRepository: PracticeSessionRepository,
    private readonly mockSubmitScheduler: MockSubmitScheduler,
  ) {}

  async clean(userId: number): Promise<void> {
    await this.mockSubmitScheduler.cancel(await this.practiceSessionRepository.findInProgressMockIds(userId));
    await this.practiceSessionRepository.removeByUser(userId);
  }
}
