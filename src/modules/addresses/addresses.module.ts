import { Module } from '@nestjs/common';
import { AddressesController } from './addresses.controller';
import { AddressesService } from './addresses.service';
import { RelationalAddressPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { RegionsModule } from '../regions/regions.module';
import { AddressesAccountCleaner } from './addresses-account.cleaner';

@Module({
  imports: [RelationalAddressPersistenceModule, RegionsModule],
  controllers: [AddressesController],
  providers: [AddressesService, AddressesAccountCleaner],
  exports: [AddressesService, RelationalAddressPersistenceModule],
})
export class AddressesModule {}
