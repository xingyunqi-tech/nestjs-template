import { AiConversation } from '../../../../domain/ai-conversation';
import { AiConversationEntity } from '../entities/ai-conversation.entity';

export class AiConversationMapper {
  static toDomain(raw: AiConversationEntity): AiConversation {
    const domain = new AiConversation();
    domain.id = raw.id;
    domain.userId = raw.userId;
    domain.title = raw.title;
    domain.contextType = raw.contextType;
    domain.contextId = raw.contextId;
    domain.contextVersion = raw.contextVersion;
    domain.summary = raw.summary;
    domain.summaryUpToMessageId = raw.summaryUpToMessageId;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }
}
