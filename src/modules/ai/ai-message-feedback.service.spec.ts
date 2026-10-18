import { NotFoundException } from '@nestjs/common';
import { AiMessageFeedbackService } from './ai-message-feedback.service';
import { AiConversationsService } from './ai-conversations.service';
import { AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiContextType, AiConversation } from './domain/ai-conversation';
import { AiMessage, AiMessageFeedback, AiMessageRole, AiMessageStatus } from './domain/ai-message';
import { FeedbacksService } from '../feedbacks/feedbacks.service';
import { BusinessException } from '../../common/exceptions/business.exception';

describe('AiMessageFeedbackService', () => {
  const createdAt = new Date('2026-10-18T02:00:00Z');
  const message = Object.assign(new AiMessage(), {
    id: 'm1',
    conversationId: 'c1',
    role: AiMessageRole.ASSISTANT,
    status: AiMessageStatus.DONE,
    createdAt,
  });
  const conversation = Object.assign(new AiConversation(), {
    id: 'c1',
    userId: 7,
    contextType: AiContextType.QUESTION,
    contextId: 'q1',
    contextVersion: 2,
  });
  let conversations: {
    findOwnedAssistantMessage: ReturnType<typeof vi.fn>;
    findReadableAssistant: ReturnType<typeof vi.fn>;
    present: ReturnType<typeof vi.fn>;
  };
  let messages: { setFeedback: ReturnType<typeof vi.fn> };
  let feedbacks: { createAiContentReport: ReturnType<typeof vi.fn> };
  let service: AiMessageFeedbackService;

  beforeEach(() => {
    conversations = {
      findOwnedAssistantMessage: vi.fn().mockResolvedValue(message),
      findReadableAssistant: vi.fn().mockResolvedValue({ message, conversation }),
      present: vi.fn().mockResolvedValue({ content: '讲解', reasoning: '思考' }),
    };
    messages = { setFeedback: vi.fn().mockResolvedValue(undefined) };
    feedbacks = { createAiContentReport: vi.fn().mockResolvedValue({ id: 1 }) };
    service = new AiMessageFeedbackService(
      conversations as unknown as AiConversationsService,
      messages as unknown as AiMessageRepository,
      feedbacks as unknown as FeedbacksService,
    );
  });

  it('should set and withdraw the feedback of an own answer', async () => {
    await service.rate(7, 'm1', AiMessageFeedback.DISLIKE);
    await service.rate(7, 'm1', null);

    expect(conversations.findOwnedAssistantMessage).toHaveBeenCalledWith(7, 'm1');
    expect(messages.setFeedback).toHaveBeenNthCalledWith(1, 'm1', AiMessageFeedback.DISLIKE);
    expect(messages.setFeedback).toHaveBeenNthCalledWith(2, 'm1', null);
  });

  it('should not rate a message that is not an own answer', async () => {
    conversations.findOwnedAssistantMessage.mockRejectedValue(new NotFoundException());

    await expect(service.rate(7, 'm1', AiMessageFeedback.LIKE)).rejects.toBeInstanceOf(NotFoundException);
    expect(messages.setFeedback).not.toHaveBeenCalled();
  });

  it('should create an ai_content report with the question and a snapshot of the answer', async () => {
    await expect(service.report(7, 'm1', { content: '内容有误' })).resolves.toEqual({ id: 1 });

    expect(conversations.findReadableAssistant).toHaveBeenCalledWith(7, 'm1');
    expect(feedbacks.createAiContentReport).toHaveBeenCalledWith(7, {
      messageId: 'm1',
      questionId: 'q1',
      questionVersion: 2,
      content: '内容有误',
      messageSnapshot: {
        content: '讲解',
        reasoning: '思考',
        status: AiMessageStatus.DONE,
        createdAt: createdAt.toISOString(),
      },
    });
  });

  it('should not report an answer whose question is hidden', async () => {
    conversations.findReadableAssistant.mockRejectedValue(new BusinessException('answerHidden'));

    await expect(service.report(7, 'm1', {})).rejects.toMatchObject({ errorKey: 'answerHidden' });
    expect(feedbacks.createAiContentReport).not.toHaveBeenCalled();
  });
});
