import { AiConversation } from './domain/ai-conversation';
import { AiMessage } from './domain/ai-message';
import { AiConversationDto } from './dto/ai-conversation.dto';
import { AiMessageDto } from './dto/ai-message.dto';
import { AiStreamSnapshot } from './ai-message-stream.service';

const TITLE_MAX_LENGTH = 50;

export function toTitle(text: string): string {
  const plain = text
    .replace(/!\[[^\]]*]\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > TITLE_MAX_LENGTH ? `${plain.slice(0, TITLE_MAX_LENGTH)}…` : plain;
}

export function toConversationDto(conversation: AiConversation): AiConversationDto {
  return Object.assign(new AiConversationDto(), {
    id: conversation.id,
    title: conversation.title,
    contextType: conversation.contextType,
    contextId: conversation.contextId,
    contextVersion: conversation.contextVersion,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  });
}

/** 生成中的消息以事件流中已下发的内容为准 */
export function toMessageDto(message: AiMessage, snapshot: AiStreamSnapshot | null = null): AiMessageDto {
  return Object.assign(new AiMessageDto(), {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: snapshot?.content ?? message.content,
    reasoning: snapshot ? snapshot.reasoning : message.reasoning,
    suggestions: snapshot ? snapshot.suggestions : message.suggestions,
    status: message.status,
    feedback: message.feedback,
    lastEventId: snapshot?.lastEventId ?? null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  });
}
