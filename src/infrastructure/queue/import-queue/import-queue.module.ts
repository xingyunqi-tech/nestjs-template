import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ImportQueueProcessor } from './import-queue.processor';
import { IMPORT_QUEUE } from './import-queue.constants';
import { ImportsCoreModule } from '../../../modules/imports/imports-core.module';

@Module({
  imports: [BullModule.registerQueue({ name: IMPORT_QUEUE }), ImportsCoreModule],
  providers: [ImportQueueProcessor],
  exports: [ImportQueueProcessor],
})
export class ImportQueueModule {}
