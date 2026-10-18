import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { AccountCleanupQueueProcessor } from './account-cleanup-queue.processor';
import { ACCOUNT_CLEANUP_QUEUE } from './account-cleanup-queue.constants';
import { AccountCleanupModule } from '../../../modules/account-cleanup/account-cleanup.module';

@Module({
  imports: [BullModule.registerQueue({ name: ACCOUNT_CLEANUP_QUEUE }), AccountCleanupModule],
  providers: [AccountCleanupQueueProcessor],
  exports: [AccountCleanupQueueProcessor],
})
export class AccountCleanupQueueModule {}
