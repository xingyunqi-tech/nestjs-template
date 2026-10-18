import { Injectable } from '@nestjs/common';
import { UserExamProfileRepository } from './infrastructure/persistence/user-exam-profile.repository';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';

@AccountCleaner({ order: 50 })
@Injectable()
export class ExamsAccountCleaner implements AccountDataCleaner {
  readonly name = 'exam-profiles';

  constructor(private readonly profileRepository: UserExamProfileRepository) {}

  clean(userId: number): Promise<void> {
    return this.profileRepository.removeByUser(userId);
  }
}
