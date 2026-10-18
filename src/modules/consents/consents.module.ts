import { Module } from '@nestjs/common';
import { RelationalConsentPersistenceModule } from './infrastructure/persistence/relational/relational-persistence.module';
import { ConsentsService } from './consents.service';
import { ConsentsController } from './consents.controller';
import { AppConfigModule } from '../config/config.module';

@Module({
  imports: [RelationalConsentPersistenceModule, AppConfigModule],
  controllers: [ConsentsController],
  providers: [ConsentsService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
