import { Injectable, Logger } from '@nestjs/common';
import { WechatMsgSecCheckScene, WechatService } from '../../integrations/wechat/wechat.service';
import { BusinessException } from '../../common/exceptions/business.exception';

export type OutputVerdict = 'pass' | 'blocked' | 'error';

/** 微信文本内容安全检测；suggest 不为 pass（含 review）均视为不通过 */
@Injectable()
export class AiContentSafetyService {
  private readonly logger = new Logger(AiContentSafetyService.name);

  constructor(private readonly wechatService: WechatService) {}

  /** @throws BusinessException contentBlocked 未通过；检测调用失败时 aiUnavailable */
  async assertInputSafe(openId: string, content: string): Promise<void> {
    let pass: boolean;
    try {
      ({ pass } = await this.check(openId, content));
    } catch (error) {
      this.logger.error(`Input security check failed: ${this.messageOf(error)}`);
      throw new BusinessException('aiUnavailable');
    }
    if (!pass) {
      throw new BusinessException('contentBlocked');
    }
  }

  async checkOutput(openId: string, content: string): Promise<OutputVerdict> {
    if (content.trim() === '') {
      return 'pass';
    }
    try {
      const result = await this.check(openId, content);
      if (!result.pass) {
        this.logger.warn(`AI output blocked: suggest=${result.suggest} label=${result.label} trace=${result.traceId}`);
      }
      return result.pass ? 'pass' : 'blocked';
    } catch (error) {
      this.logger.error(`Output security check failed: ${this.messageOf(error)}`);
      return 'error';
    }
  }

  private check(openId: string, content: string): ReturnType<WechatService['msgSecCheck']> {
    return this.wechatService.msgSecCheck({ openId, scene: WechatMsgSecCheckScene.COMMENT, content });
  }

  private messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
