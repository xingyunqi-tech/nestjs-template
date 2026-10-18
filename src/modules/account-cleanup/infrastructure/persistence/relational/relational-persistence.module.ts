import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountCleanupEntity } from './entities/account-cleanup.entity';
import { AccountCleanupRepository } from '../account-cleanup.repository';
import { AccountCleanupRelationalRepository } from './repositories/account-cleanup.repository';

@Module({
  imports: [TypeOrmModule.forFeature([AccountCleanupEntity])],
  providers: [{ provide: AccountCleanupRepository, useClass: AccountCleanupRelationalRepository }],
  exports: [AccountCleanupRepository],
})
export class RelationalAccountCleanupPersistenceModule {}
