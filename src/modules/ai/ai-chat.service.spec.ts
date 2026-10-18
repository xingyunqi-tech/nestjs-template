import { ConflictException } from '@nestjs/common';
import { AiChatService } from './ai-chat.service';
import { AiConversationsService } from './ai-conversations.service';
import { AiAccessService } from './ai-access.service';
import { AiContentSafetyService } from './ai-content-safety.service';
import { AiBudgetService } from './ai-budget.service';
import { AiQuotaService } from './ai-quota.service';
import { AiContextService } from './ai-context.service';
import { AiMessageStreamService } from './ai-message-stream.service';
import { AiGenerationService } from './ai-generation.service';
import { AiMessageInProgressError, AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiContextType, AiConversation } from './domain/ai-conversation';
import { AiMessage, AiMessageRole, AiMessageStatus } from './domain/ai-message';
import { AiStreamEventName } from './domain/ai-stream-event';
import { TutorQuestionContextService } from '../practice/tutor-question-context.service';
import { BusinessException } from '../../common/exceptions/business.exception';

describe('AiChatService', () => {
  const conversation = Object.assign(new AiConversation(), {
    id: 'c1',
    userId: 7,
    contextType: AiContextType.QUESTION,
    contextId: 'q1',
    contextVersion: 1,
    summary: null,
    summaryUpToMessageId: null,
  });
  const assistant = Object.assign(new AiMessage(), {
    id: 'm2',
    role: AiMessageRole.ASSISTANT,
    status: AiMessageStatus.STREAMING,
  });
  const tutor = { question: { id: 'q1', currentVersion: 1 }, material: null, record: null };
  const request = { system: 's', messages: [{ role: 'user' as const, content: '为什么' }] };

  let calls: string[];
  let conversations: { findOwned: ReturnType<typeof vi.fn>; findOwnedAssistantMessage: ReturnType<typeof vi.fn> };
  let messages: {
    findStreamingIds: ReturnType<typeof vi.fn>;
    createExchange: ReturnType<typeof vi.fn>;
    finish: ReturnType<typeof vi.fn>;
  };
  let access: { assertCanUse: ReturnType<typeof vi.fn> };
  let tutorContext: { resolve: ReturnType<typeof vi.fn> };
  let safety: { assertInputSafe: ReturnType<typeof vi.fn> };
  let budget: { assertWithinBudget: ReturnType<typeof vi.fn> };
  let quota: { consume: ReturnType<typeof vi.fn>; refund: ReturnType<typeof vi.fn> };
  let context: { buildChatRequest: ReturnType<typeof vi.fn> };
  let stream: { append: ReturnType<typeof vi.fn> };
  let generation: { start: ReturnType<typeof vi.fn>; requestStop: ReturnType<typeof vi.fn> };
  let service: AiChatService;

  const step = <T>(name: string, value?: T) =>
    vi.fn(() => {
      calls.push(name);
      return Promise.resolve(value);
    });

  beforeEach(() => {
    calls = [];
    conversations = {
      findOwned: step('findOwned', conversation),
      findOwnedAssistantMessage: vi.fn().mockResolvedValue(assistant),
    };
    messages = {
      findStreamingIds: step('findStreamingIds', []),
      createExchange: step('createExchange', { user: new AiMessage(), assistant }),
      finish: vi.fn().mockResolvedValue(true),
    };
    access = { assertCanUse: step('assertCanUse', { openId: 'open-1' }) };
    tutorContext = { resolve: step('resolveVisibility', tutor) };
    safety = { assertInputSafe: step('assertInputSafe') };
    budget = { assertWithinBudget: step('assertWithinBudget') };
    quota = { consume: step('consume', '2026-10-18'), refund: vi.fn().mockResolvedValue(undefined) };
    context = { buildChatRequest: step('buildChatRequest', request) };
    stream = { append: step('appendStart', '1-0') };
    generation = { start: vi.fn().mockResolvedValue(undefined), requestStop: vi.fn().mockResolvedValue(undefined) };
    service = new AiChatService(
      conversations as unknown as AiConversationsService,
      messages as unknown as AiMessageRepository,
      access as unknown as AiAccessService,
      tutorContext as unknown as TutorQuestionContextService,
      safety as unknown as AiContentSafetyService,
      budget as unknown as AiBudgetService,
      quota as unknown as AiQuotaService,
      context as unknown as AiContextService,
      stream as unknown as AiMessageStreamService,
      generation as unknown as AiGenerationService,
    );
  });

  it('should check prerequisites, visibility, input, budget and quota in order before starting generation', async () => {
    await expect(service.send(7, 'c1', { content: '为什么', sessionId: 's1' })).resolves.toEqual({ messageId: 'm2' });

    expect(calls).toEqual([
      'findOwned',
      'assertCanUse',
      'resolveVisibility',
      'findStreamingIds',
      'assertInputSafe',
      'assertWithinBudget',
      'consume',
      'buildChatRequest',
      'createExchange',
      'appendStart',
    ]);
    expect(tutorContext.resolve).toHaveBeenCalledWith(7, 'q1', 's1');
    expect(messages.createExchange).toHaveBeenCalledWith({
      conversationId: 'c1',
      content: '为什么',
      quotaDate: '2026-10-18',
      title: '为什么',
    });
    expect(stream.append).toHaveBeenCalledWith('m2', AiStreamEventName.MESSAGE_START, { messageId: 'm2' });
    expect(generation.start).toHaveBeenCalledWith({
      messageId: 'm2',
      conversationId: 'c1',
      userId: 7,
      openId: 'open-1',
      quotaDate: '2026-10-18',
      request,
    });
  });

  it('should reject a hidden answer before any check or quota consumption', async () => {
    tutorContext.resolve.mockRejectedValue(new BusinessException('answerHidden'));

    await expect(service.send(7, 'c1', { content: '为什么' })).rejects.toMatchObject({ errorKey: 'answerHidden' });
    expect(tutorContext.resolve).toHaveBeenCalledWith(7, 'q1', null);
    expect(safety.assertInputSafe).not.toHaveBeenCalled();
    expect(quota.consume).not.toHaveBeenCalled();
  });

  it('should reject a conversation of an outdated question version before any check', async () => {
    tutorContext.resolve.mockResolvedValue({ ...tutor, question: { id: 'q1', currentVersion: 2 } });

    await expect(service.send(7, 'c1', { content: '为什么' })).rejects.toMatchObject({
      errorKey: 'aiConversationOutdated',
    });
    expect(safety.assertInputSafe).not.toHaveBeenCalled();
    expect(quota.consume).not.toHaveBeenCalled();
  });

  it('should not consume quota when the input is blocked', async () => {
    safety.assertInputSafe.mockRejectedValue(new BusinessException('contentBlocked'));

    await expect(service.send(7, 'c1', { content: '违规' })).rejects.toMatchObject({ errorKey: 'contentBlocked' });
    expect(quota.consume).not.toHaveBeenCalled();
    expect(messages.createExchange).not.toHaveBeenCalled();
  });

  it('should not consume quota when the daily budget is exceeded', async () => {
    budget.assertWithinBudget.mockRejectedValue(new BusinessException('aiUnavailable'));

    await expect(service.send(7, 'c1', { content: '为什么' })).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
    expect(quota.consume).not.toHaveBeenCalled();
  });

  it('should reject while another answer of the conversation is generating', async () => {
    messages.findStreamingIds.mockResolvedValue(['m0']);

    await expect(service.send(7, 'c1', { content: '为什么' })).rejects.toBeInstanceOf(ConflictException);
    expect(quota.consume).not.toHaveBeenCalled();
  });

  it('should refund the quota when a concurrent answer is found while saving the messages', async () => {
    messages.createExchange.mockRejectedValue(new AiMessageInProgressError());

    await expect(service.send(7, 'c1', { content: '为什么' })).rejects.toBeInstanceOf(ConflictException);
    expect(quota.refund).toHaveBeenCalledWith(7, 'chat', '2026-10-18');
    expect(messages.finish).not.toHaveBeenCalled();
    expect(generation.start).not.toHaveBeenCalled();
  });

  it('should answer aiUnavailable, fail the answer and refund the quota when the stream cannot be started', async () => {
    stream.append.mockRejectedValue(new Error('redis down'));

    await expect(service.send(7, 'c1', { content: '为什么' })).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
    expect(messages.finish).toHaveBeenCalledWith('m2', expect.objectContaining({ status: AiMessageStatus.FAILED }));
    expect(quota.refund).toHaveBeenCalledWith(7, 'chat', '2026-10-18');
    expect(generation.start).not.toHaveBeenCalled();
  });

  it('should not refund when the answer was already closed elsewhere during rollback', async () => {
    stream.append.mockRejectedValue(new Error('redis down'));
    messages.finish.mockResolvedValue(false);

    await expect(service.send(7, 'c1', { content: '为什么' })).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
    expect(quota.refund).not.toHaveBeenCalled();
  });

  it('should not refund when the answer cannot be marked failed during rollback', async () => {
    stream.append.mockRejectedValue(new Error('redis down'));
    messages.finish.mockRejectedValue(new Error('db down'));

    await expect(service.send(7, 'c1', { content: '为什么' })).rejects.toMatchObject({ errorKey: 'aiUnavailable' });
    expect(quota.refund).not.toHaveBeenCalled();
  });

  it('should broadcast a stop only while the answer is generating', async () => {
    await service.stop(7, 'm2');
    conversations.findOwnedAssistantMessage.mockResolvedValue({ ...assistant, status: AiMessageStatus.DONE });
    await service.stop(7, 'm2');

    expect(generation.requestStop).toHaveBeenCalledTimes(1);
    expect(generation.requestStop).toHaveBeenCalledWith('m2');
  });
});
