import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { RelationalAccountCleanupPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { AccountCleanupRunner } from './account-cleanup.runner';
import { AccountCleanupService } from './account-cleanup.service';
import { AccountCleanupCompensationTask } from './account-cleanup-compensation.task';
import { AdminAccountCleanupController } from './admin-account-cleanup.controller';
import { UsersModule } from '../../core/users/users.module';
import { SchedulerModule } from '../../infrastructure/scheduler/scheduler.module';
import { AccountCleanupProducerModule } from '../../infrastructure/account-cleanup/account-cleanup-producer.module';

@Module({
  imports: [
    DiscoveryModule,
    RelationalAccountCleanupPersistenceModule,
    AccountCleanupProducerModule,
    UsersModule,
    SchedulerModule,
  ],
  controllers: [AdminAccountCleanupController],
  providers: [AccountCleanupRunner, AccountCleanupService, AccountCleanupCompensationTask],
  exports: [AccountCleanupRunner],
})
export class AccountCleanupModule {}
