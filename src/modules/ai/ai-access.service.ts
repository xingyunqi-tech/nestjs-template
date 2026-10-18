import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/config.service';
import { ConsentsService } from '../consents/consents.service';
import { UsersService } from '../../core/users/users.service';
import { BusinessException } from '../../common/exceptions/business.exception';

/** 使用 AI 的前置条件：总开关开启、已绑定微信、已同意当前版本 AI 服务声明 */
@Injectable()
export class AiAccessService {
  constructor(
    private readonly appConfigService: AppConfigService,
    private readonly usersService: UsersService,
    private readonly consentsService: ConsentsService,
  ) {}

  /** @throws BusinessException aiUnavailable、wechatBindingRequired、aiConsentRequired */
  async assertCanUse(userId: number): Promise<{ openId: string }> {
    if ((await this.appConfigService.getValue<unknown>('ai.enabled')) !== true) {
      throw new BusinessException('aiUnavailable');
    }
    const user = await this.usersService.findById(userId);
    if (!user?.wechatOpenId) {
      throw new BusinessException('wechatBindingRequired');
    }
    if (!(await this.consentsService.hasAgreedAiService(userId))) {
      throw new BusinessException('aiConsentRequired');
    }
    return { openId: user.wechatOpenId };
  }
}
