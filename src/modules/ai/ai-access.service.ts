import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { ConsentsService } from '../consents/consents.service';
import { UsersService } from '../../core/users/users.service';
import { ContentModerationProvider } from '../../integrations/aliyun-green/content-moderation-provider';
import { BusinessException } from '../../common/exceptions/business.exception';

/** 使用 AI 的前置条件：总开关开启且内容审核已配置、已绑定手机号、已同意当前版本 AI 服务声明 */
@Injectable()
export class AiAccessService {
  constructor(
    private readonly appConfigService: AppConfigService,
    private readonly usersService: UsersService,
    private readonly consentsService: ConsentsService,
    private readonly moderationProvider: ContentModerationProvider,
  ) {}

  /** @throws BusinessException aiUnavailable、phoneBindingRequired、aiConsentRequired */
  async assertCanUse(userId: number): Promise<void> {
    if (
      (await this.appConfigService.getValue<unknown>('ai.enabled')) !== true ||
      !this.moderationProvider.isConfigured()
    ) {
      throw new BusinessException('aiUnavailable');
    }
    const user = await this.usersService.findById(userId);
    if (!user?.phone) {
      throw new BusinessException('phoneBindingRequired');
    }
    if (!(await this.consentsService.hasAgreedAiService(userId))) {
      throw new BusinessException('aiConsentRequired');
    }
  }
}
