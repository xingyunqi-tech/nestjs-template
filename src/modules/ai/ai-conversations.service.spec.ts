import { NotFoundException } from '@nestjs/common';
import { AiConversationsService } from './ai-conversations.service';
import { AiConversationRepository } from './infrastructure/persistence/ai-conversation.repository';
import { AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiAccessService } from './ai-access.service';
import { AiMessageStreamService } from './ai-message-stream.service';
import { AiGenerationService } from './ai-generation.service';
import { AiContextType, AiConversation } from './domain/ai-conversation';
import { AiMessage, AiMessageRole, AiMessageStatus } from './domain/ai-message';
import { TutorQuestionContextService } from '../practice/tutor-question-context.service';
import { AnswerVisibilityService } from '../practice/answer-visibility.service';
import { BusinessException } from '../../common/exceptions/business.exception';

describe('AiConversationsService', () => {
  const conversation = Object.assign(new AiConversation(), { id: 'c1', userId: 7, title: 't', contextId: 'q1' });
  let conversations: Record<string, ReturnType<typeof vi.fn>>;
  let messages: Record<string, ReturnType<typeof vi.fn>>;
  let access: { assertCanUse: ReturnType<typeof vi.fn> };
  let tutorContext: { resolve: ReturnType<typeof vi.fn> };
  let stream: { snapshot: ReturnType<typeof vi.fn> };
  let generation: { requestStop: ReturnType<typeof vi.fn> };
  let inMock: Set<string>;
  let service: AiConversationsService;

  beforeEach(() => {
    conversations = {
      findOrCreate: vi.fn().mockResolvedValue(conversation),
      findById: vi.fn().mockResolvedValue(conversation),
      remove: vi.fn().mockResolvedValue(undefined),
    };
    messages = {
      findOwned: vi.fn(),
      findPage: vi.fn(),
      findStreamingIds: vi.fn().mockResolvedValue([]),
    };
    access = { assertCanUse: vi.fn().mockResolvedValue({ openId: 'o' }) };
    tutorContext = {
      resolve: vi.fn().mockResolvedValue({
        question: { id: 'q1', stem: '已知 ![图](file:1)  函数\n f(x)', currentVersion: 3 },
        material: null,
        record: null,
      }),
    };
    stream = { snapshot: vi.fn() };
    generation = { requestStop: vi.fn().mockResolvedValue(undefined) };
    inMock = new Set();
    const visibility = { findInProgressMockQuestionIds: vi.fn(() => Promise.resolve(inMock)) };
    service = new AiConversationsService(
      conversations as unknown as AiConversationRepository,
      messages as unknown as AiMessageRepository,
      access as unknown as AiAccessService,
      tutorContext as unknown as TutorQuestionContextService,
      stream as unknown as AiMessageStreamService,
      generation as unknown as AiGenerationService,
      visibility as unknown as AnswerVisibilityService,
    );
  });

  it('should create or reuse the conversation of the question version after the checks', async () => {
    await service.create(7, { contextType: AiContextType.QUESTION, contextId: 'q1', sessionId: 's1' });

    expect(access.assertCanUse).toHaveBeenCalledWith(7);
    expect(tutorContext.resolve).toHaveBeenCalledWith(7, 'q1', 's1');
    expect(conversations.findOrCreate).toHaveBeenCalledWith({
      userId: 7,
      title: '已知 函数 f(x)',
      contextType: AiContextType.QUESTION,
      contextId: 'q1',
      contextVersion: 3,
    });
  });

  it('should not create a conversation when the question is not in the session', async () => {
    tutorContext.resolve.mockRejectedValue(new BusinessException('questionNotAccessible'));

    await expect(
      service.create(7, { contextType: AiContextType.QUESTION, contextId: 'q1', sessionId: 's1' }),
    ).rejects.toMatchObject({ errorKey: 'questionNotAccessible' });
    expect(conversations.findOrCreate).not.toHaveBeenCalled();
  });

  it("should hide another user's conversation", async () => {
    conversations.findById.mockResolvedValue({ ...conversation, userId: 8 });

    await expect(service.findMessages(7, 'c1', {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should hide the messages while the question is in a mock in progress', async () => {
    inMock.add('q1');

    await expect(service.findMessages(7, 'c1', {})).rejects.toMatchObject({ errorKey: 'answerHidden' });
    expect(messages.findPage).not.toHaveBeenCalled();
  });

  it('should hide a single answer and its event stream while the question is in a mock in progress', async () => {
    messages.findOwned.mockResolvedValue(
      Object.assign(new AiMessage(), { id: 'm1', conversationId: 'c1', role: AiMessageRole.ASSISTANT }),
    );
    inMock.add('q1');

    const error = await service.findReadableAssistantMessage(7, 'm1').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).getResponse()).toEqual({
      error: 'answerHidden',
      errors: { hiddenReason: 'mockInProgress', errorKey: 'answerHidden' },
    });
    await expect(service.getMessage(7, 'm1')).rejects.toMatchObject({ errorKey: 'answerHidden' });
    expect(stream.snapshot).not.toHaveBeenCalled();
  });

  it('should present a generating answer with the delivered content and the resume position', async () => {
    messages.findOwned.mockResolvedValue(
      Object.assign(new AiMessage(), {
        id: 'm1',
        conversationId: 'c1',
        role: AiMessageRole.ASSISTANT,
        status: AiMessageStatus.STREAMING,
        content: '',
        reasoning: null,
        suggestions: null,
      }),
    );
    stream.snapshot.mockResolvedValue({ content: '已下发', reasoning: null, suggestions: null, lastEventId: '4-0' });

    await expect(service.getMessage(7, 'm1')).resolves.toMatchObject({
      content: '已下发',
      status: AiMessageStatus.STREAMING,
      lastEventId: '4-0',
    });
  });

  it('should only return assistant messages', async () => {
    messages.findOwned.mockResolvedValue(Object.assign(new AiMessage(), { role: AiMessageRole.USER }));

    await expect(service.getMessage(7, 'm1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should stop generating answers before deleting the conversation', async () => {
    messages.findStreamingIds.mockResolvedValue(['m1']);

    await service.remove(7, 'c1');

    expect(generation.requestStop).toHaveBeenCalledWith('m1');
    expect(conversations.remove).toHaveBeenCalledWith('c1');
  });
});
