import { Module } from '@nestjs/common';
import { FeedbacksController } from './feedbacks.controller';
import { FeedbacksService } from './feedbacks.service';
import { RelationalFeedbackPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { FeedbacksAccountCleaner } from './feedbacks-account.cleaner';

@Module({
  imports: [RelationalFeedbackPersistenceModule],
  controllers: [FeedbacksController],
  providers: [FeedbacksAccountCleaner, FeedbacksService],
  exports: [FeedbacksService, RelationalFeedbackPersistenceModule],
})
export class FeedbacksModule {}
