import type { ConfigService } from '@nestjs/config';
import { AiContextService } from './ai-context.service';
import { AiConversationRepository } from './infrastructure/persistence/ai-conversation.repository';
import { AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiBudgetService } from './ai-budget.service';
import { AiConversation } from './domain/ai-conversation';
import { AiMessage, AiMessageRole, AiMessageStatus } from './domain/ai-message';
import { LlmProvider } from '../../integrations/llm/llm-provider';
import { TutorQuestionContext } from '../practice/tutor-question-context.service';
import { QuestionType } from '../questions/domain/question-type';

describe('AiContextService', () => {
  const tutor = {
    question: { type: QuestionType.SHORT_ANSWER, stem: '题干', options: null, answer: null, analysis: null },
    material: null,
    record: { answer: { text: '我的作答' }, isCorrect: null },
  } as unknown as TutorQuestionContext;
  const conversation = Object.assign(new AiConversation(), {
    id: 'c1',
    summary: '早期摘要',
    summaryUpToMessageId: 'm0',
  });

  it('should put the reference material in a user message ahead of the history', async () => {
    const history = [
      Object.assign(new AiMessage(), {
        id: 'm1',
        role: AiMessageRole.ASSISTANT,
        status: AiMessageStatus.DONE,
        content: '旧回答',
      }),
    ];
    const messages = { findAfter: vi.fn().mockResolvedValue(history) };
    const service = new AiContextService(
      {} as AiConversationRepository,
      messages as unknown as AiMessageRepository,
      {} as LlmProvider,
      {} as AiBudgetService,
      {} as ConfigService,
    );

    const request = await service.buildChatRequest(conversation, tutor, '为什么');

    expect(request.system).not.toContain('我的作答');
    expect(request.system).not.toContain('早期摘要');
    expect(request.messages).toHaveLength(3);
    expect(request.messages[0].role).toBe('user');
    expect(request.messages[0].content).toContain('<reference>\n学生作答：\n我的作答\n</reference>');
    expect(request.messages[0].content).toContain('<reference>\n此前对话摘要：\n早期摘要\n</reference>');
    expect(request.messages.slice(1)).toEqual([
      { role: 'assistant', content: '旧回答' },
      { role: 'user', content: '为什么' },
    ]);
    expect(messages.findAfter).toHaveBeenCalledWith('c1', 'm0', expect.any(Number));
  });
});
