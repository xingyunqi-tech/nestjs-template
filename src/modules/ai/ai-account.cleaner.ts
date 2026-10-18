import { Injectable, Logger } from '@nestjs/common';
import { AiConversationRepository } from './infrastructure/persistence/ai-conversation.repository';
import { AiMessageRepository } from './infrastructure/persistence/ai-message.repository';
import { AiGenerationService } from './ai-generation.service';
import { AiQuotaService } from './ai-quota.service';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';

/** 删除 AI 会话与消息（生成中的先广播停止）及额度计数；AiUsageDaily 为不含个人信息的聚合数据，保留 */
@AccountCleaner({ order: 15 })
@Injectable()
export class AiAccountCleaner implements AccountDataCleaner {
  readonly name = 'ai';
  private readonly logger = new Logger(AiAccountCleaner.name);

  constructor(
    private readonly conversationRepository: AiConversationRepository,
    private readonly messageRepository: AiMessageRepository,
    private readonly generationService: AiGenerationService,
    private readonly quotaService: AiQuotaService,
  ) {}

  async clean(userId: number): Promise<void> {
    const streamingIds = await this.messageRepository.findStreamingIdsByUser(userId);
    await Promise.all(
      streamingIds.map((id) =>
        this.generationService
          .requestStop(id)
          .catch((error: unknown) =>
            this.logger.warn(`Stop ${id} failed: ${error instanceof Error ? error.message : String(error)}`),
          ),
      ),
    );
    await this.conversationRepository.removeByUser(userId);
    await this.quotaService.clear(userId);
  }
}
