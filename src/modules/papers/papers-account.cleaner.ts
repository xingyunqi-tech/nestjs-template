import { Injectable } from '@nestjs/common';
import { PaperRepository } from './infrastructure/persistence/paper.repository';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';

@AccountCleaner({ order: 20 })
@Injectable()
export class PapersAccountCleaner implements AccountDataCleaner {
  readonly name = 'papers';

  constructor(private readonly paperRepository: PaperRepository) {}

  clean(userId: number): Promise<void> {
    return this.paperRepository.removeGeneratedByOwner(userId);
  }
}
