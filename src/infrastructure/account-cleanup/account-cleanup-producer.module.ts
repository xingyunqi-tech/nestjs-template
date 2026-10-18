import { Module } from '@nestjs/common';
import { ConditionalModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AccountCleanupProducer } from './account-cleanup.producer';
import { isRedisEnabled } from '../redis/config/redis.config';
import { ACCOUNT_CLEANUP_QUEUE } from '../queue/account-cleanup-queue/account-cleanup-queue.constants';

@Module({
  imports: [ConditionalModule.registerWhen(BullModule.registerQueue({ name: ACCOUNT_CLEANUP_QUEUE }), isRedisEnabled)],
  providers: [AccountCleanupProducer],
  exports: [AccountCleanupProducer],
})
export class AccountCleanupProducerModule {}
