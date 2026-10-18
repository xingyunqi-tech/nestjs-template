import { Injectable } from '@nestjs/common';
import { ErrataRepository } from './infrastructure/persistence/errata.repository';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';

@AccountCleaner({ order: 120 })
@Injectable()
export class ErrataAccountCleaner implements AccountDataCleaner {
  readonly name = 'errata';

  constructor(private readonly errataRepository: ErrataRepository) {}

  clean(userId: number): Promise<void> {
    return this.errataRepository.removeUserLinks(userId);
  }
}
