import { Injectable } from '@nestjs/common';
import { AddressRepository } from './infrastructure/persistence/address.repository';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';

@AccountCleaner({ order: 110 })
@Injectable()
export class AddressesAccountCleaner implements AccountDataCleaner {
  readonly name = 'addresses';

  constructor(private readonly addressRepository: AddressRepository) {}

  clean(userId: number): Promise<void> {
    return this.addressRepository.removeByUser(userId);
  }
}
