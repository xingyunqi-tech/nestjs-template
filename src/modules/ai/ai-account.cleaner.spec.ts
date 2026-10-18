import { AiAccountCleaner } from './ai-account.cleaner';
import { AiConversationRepository } from './infrastructure/persistence/ai-conversation.repository';
import { AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiGenerationService } from './ai-generation.service';
import { AiQuotaService } from './ai-quota.service';

describe('AiAccountCleaner', () => {
  it('should stop generating answers before removing the conversations and quota counters', async () => {
    const calls: string[] = [];
    const conversations = { removeByUser: vi.fn(() => calls.push('removeByUser')) };
    const messages = { findStreamingIdsByUser: vi.fn().mockResolvedValue(['m1', 'm2']) };
    const generation = {
      requestStop: vi.fn((id: string) => {
        calls.push(`stop:${id}`);
        return id === 'm2' ? Promise.reject(new Error('redis down')) : Promise.resolve();
      }),
    };
    const quota = { clear: vi.fn(() => calls.push('clearQuota')) };
    const cleaner = new AiAccountCleaner(
      conversations as unknown as AiConversationRepository,
      messages as unknown as AiMessageRepository,
      generation as unknown as AiGenerationService,
      quota as unknown as AiQuotaService,
    );

    await cleaner.clean(7);

    expect(messages.findStreamingIdsByUser).toHaveBeenCalledWith(7);
    expect(calls).toEqual(['stop:m1', 'stop:m2', 'removeByUser', 'clearQuota']);
    expect(conversations.removeByUser).toHaveBeenCalledWith(7);
    expect(quota.clear).toHaveBeenCalledWith(7);
  });
});
