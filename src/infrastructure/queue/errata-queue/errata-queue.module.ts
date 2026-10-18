import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ErrataQueueProcessor } from './errata-queue.processor';
import { ERRATA_QUEUE } from './errata-queue.constants';
import { ErrataModule } from '../../../modules/errata/errata.module';

@Module({
  imports: [BullModule.registerQueue({ name: ERRATA_QUEUE }), ErrataModule],
  providers: [ErrataQueueProcessor],
  exports: [ErrataQueueProcessor],
})
export class ErrataQueueModule {}
