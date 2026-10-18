import { FeedbacksService } from './feedbacks.service';
import { FeedbackRepository } from './infrastructure/persistence/feedback.repository';
import { Feedback, FeedbackType } from './domain/feedback';

describe('FeedbacksService', () => {
  const input = {
    messageId: 'm1',
    questionId: 'q1',
    questionVersion: 1,
    content: '有误',
    messageSnapshot: { content: '讲解', reasoning: null, status: 'DONE', createdAt: '2026-10-18T02:00:00.000Z' },
  };
  let repository: { findOpenAiContentReport: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  let service: FeedbacksService;

  beforeEach(() => {
    repository = {
      findOpenAiContentReport: vi.fn().mockResolvedValue(null),
      create: vi.fn((data: Partial<Feedback>) => Promise.resolve({ id: 2, ...data })),
    };
    service = new FeedbacksService(repository as unknown as FeedbackRepository);
  });

  it('should create an ai_content report with the message snapshot', async () => {
    await expect(service.createAiContentReport(7, input)).resolves.toMatchObject({
      id: 2,
      userId: 7,
      type: FeedbackType.AI_CONTENT,
      messageId: 'm1',
      messageSnapshot: input.messageSnapshot,
    });
    expect(repository.findOpenAiContentReport).toHaveBeenCalledWith(7, 'm1');
  });

  it('should return the open report of the same message instead of creating another one', async () => {
    const open = { id: 1, type: FeedbackType.AI_CONTENT, messageId: 'm1' };
    repository.findOpenAiContentReport.mockResolvedValue(open);

    await expect(service.createAiContentReport(7, input)).resolves.toBe(open);
    expect(repository.create).not.toHaveBeenCalled();
  });
});
