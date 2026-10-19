import { Injectable, Logger } from '@nestjs/common';
import { ContentModerationProvider } from '../../integrations/aliyun-green/content-moderation-provider';
import { BusinessException } from '../../common/exceptions/business.exception';

export type OutputVerdict = 'pass' | 'blocked' | 'error';

export interface OutputCheck {
  userId: number;
  /** 关联同一段连续输出的分段 */
  sessionId: string;
  content: string;
}

@Injectable()
export class AiContentSafetyService {
  private readonly logger = new Logger(AiContentSafetyService.name);

  constructor(private readonly moderationProvider: ContentModerationProvider) {}

  /** @throws BusinessException contentBlocked 未通过；检测调用失败时 aiUnavailable */
  async assertInputSafe(userId: number, content: string): Promise<void> {
    let verdict: string;
    try {
      ({ verdict } = await this.moderationProvider.moderate({ kind: 'input', content, userId }));
    } catch (error) {
      this.logger.error(`Input moderation failed: ${this.messageOf(error)}`);
      throw new BusinessException('aiUnavailable');
    }
    if (verdict !== 'pass') {
      throw new BusinessException('contentBlocked');
    }
  }

  async checkOutput({ userId, sessionId, content }: OutputCheck): Promise<OutputVerdict> {
    if (content.trim() === '') {
      return 'pass';
    }
    try {
      const result = await this.moderationProvider.moderate({
        kind: 'output',
        content,
        userId,
        sessionId,
      });
      if (result.verdict !== 'pass') {
        this.logger.warn(
          `AI output blocked: session=${sessionId} risk=${result.riskLevel} labels=${result.labels.join(',')} request=${result.requestId}`,
        );
        return 'blocked';
      }
      return 'pass';
    } catch (error) {
      this.logger.error(`Output moderation failed: ${this.messageOf(error)}`);
      return 'error';
    }
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
