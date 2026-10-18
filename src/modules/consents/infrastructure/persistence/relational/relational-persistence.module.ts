import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserConsentEntity } from './entities/user-consent.entity';
import { UserConsentRepository } from '../user-consent.repository';
import { UserConsentRelationalRepository } from './repositories/user-consent.repository';

@Module({
  imports: [TypeOrmModule.forFeature([UserConsentEntity])],
  providers: [{ provide: UserConsentRepository, useClass: UserConsentRelationalRepository }],
  exports: [UserConsentRepository],
})
export class RelationalConsentPersistenceModule {}
