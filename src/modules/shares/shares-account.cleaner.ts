import { Injectable } from '@nestjs/common';
import { ShareRepository } from './infrastructure/persistence/share.repository';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';

@AccountCleaner({ order: 80 })
@Injectable()
export class SharesAccountCleaner implements AccountDataCleaner {
  readonly name = 'shares';

  constructor(private readonly shareRepository: ShareRepository) {}

  clean(userId: number): Promise<void> {
    return this.shareRepository.removeByUser(userId);
  }
}
