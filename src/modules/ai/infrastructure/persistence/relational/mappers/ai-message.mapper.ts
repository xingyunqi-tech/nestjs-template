import { AiMessage } from '../../../../domain/ai-message';
import { AiMessageEntity } from '../entities/ai-message.entity';

export class AiMessageMapper {
  static toDomain(raw: AiMessageEntity): AiMessage {
    const domain = new AiMessage();
    domain.id = raw.id;
    domain.conversationId = raw.conversationId;
    domain.role = raw.role;
    domain.content = raw.content;
    domain.reasoning = raw.reasoning;
    domain.suggestions = raw.suggestions;
    domain.status = raw.status;
    domain.feedback = raw.feedback;
    domain.usage = raw.usage;
    domain.quotaDate = raw.quotaDate;
    domain.createdAt = raw.createdAt;
    domain.updatedAt = raw.updatedAt;
    return domain;
  }
}
