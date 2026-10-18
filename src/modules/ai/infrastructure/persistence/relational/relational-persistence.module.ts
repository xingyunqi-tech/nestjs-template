import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiConversationEntity } from './entities/ai-conversation.entity';
import { AiMessageEntity } from './entities/ai-message.entity';
import { AiUsageDailyEntity } from './entities/ai-usage-daily.entity';
import { AiConversationRepository } from '../ai-conversation.repository';
import { AiMessageRepository } from '../ai-message.repository';
import { AiUsageDailyRepository } from '../ai-usage-daily.repository';
import { AiConversationRelationalRepository } from './repositories/ai-conversation.repository';
import { AiMessageRelationalRepository } from './repositories/ai-message.repository';
import { AiUsageDailyRelationalRepository } from './repositories/ai-usage-daily.repository';

@Module({
  imports: [TypeOrmModule.forFeature([AiConversationEntity, AiMessageEntity, AiUsageDailyEntity])],
  providers: [
    { provide: AiConversationRepository, useClass: AiConversationRelationalRepository },
    { provide: AiMessageRepository, useClass: AiMessageRelationalRepository },
    { provide: AiUsageDailyRepository, useClass: AiUsageDailyRelationalRepository },
  ],
  exports: [AiConversationRepository, AiMessageRepository, AiUsageDailyRepository],
})
export class RelationalAiPersistenceModule {}
