import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MockSubmitQueueProcessor } from './mock-submit-queue.processor';
import { MOCK_SUBMIT_QUEUE } from './mock-submit-queue.constants';
import { PracticeModule } from '../../../modules/practice/practice.module';

@Module({
  imports: [BullModule.registerQueue({ name: MOCK_SUBMIT_QUEUE }), PracticeModule],
  providers: [MockSubmitQueueProcessor],
  exports: [MockSubmitQueueProcessor],
})
export class MockSubmitQueueModule {}
