import { Module } from '@nestjs/common';

import { UsersController } from './users.controller';

import { UsersService } from './users.service';
import { RelationalUserPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { FilesModule } from '../../modules/files/files.module';
import { SessionModule } from '../session/session.module';
import { UsersAccountCleaner } from './users-account.cleaner';
import { AccountCleanupProducerModule } from '../../infrastructure/account-cleanup/account-cleanup-producer.module';

@Module({
  imports: [RelationalUserPersistenceModule, FilesModule, SessionModule, AccountCleanupProducerModule],
  controllers: [UsersController],
  providers: [UsersService, UsersAccountCleaner],
  exports: [UsersService, RelationalUserPersistenceModule],
})
export class UsersModule {}
