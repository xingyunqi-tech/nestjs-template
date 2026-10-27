import { registerAs } from '@nestjs/config';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import validateConfig from '../../../common/validate-config';
import { WechatConfig, WechatMiniProgramState } from './wechat-config.type';

class EnvironmentVariablesValidator {
  @IsString()
  @IsOptional()
  WECHAT_MINI_APP_ID: string;

  @IsString()
  @IsOptional()
  WECHAT_MINI_APP_SECRET: string;

  @IsString()
  @IsOptional()
  WECHAT_MINI_GAME_APP_ID: string;

  @IsString()
  @IsOptional()
  WECHAT_MINI_GAME_APP_SECRET: string;

  @IsIn(['developer', 'trial', 'formal'])
  @IsOptional()
  WECHAT_MINI_PROGRAM_STATE: string;

  @IsString()
  @IsOptional()
  WECHAT_SUBSCRIBE_ORDER_PAID_TEMPLATE_ID: string;

  @Matches(/^\s*\w+\s*:\s*\w+\s*(,\s*\w+\s*:\s*\w+\s*)*$/, {
    message: 'WECHAT_SUBSCRIBE_ORDER_PAID_FIELDS must be like orderNo:character_string1,amount:amount2',
  })
  @IsOptional()
  WECHAT_SUBSCRIBE_ORDER_PAID_FIELDS: string;

  @IsString()
  @IsOptional()
  WECHAT_APP_ID: string;

  @IsString()
  @IsOptional()
  WECHAT_APP_SECRET: string;

  @IsString()
  @IsOptional()
  WECHAT_PAY_MCH_ID: string;

  @IsString()
  @IsOptional()
  WECHAT_PAY_API_V3_KEY: string;

  @IsString()
  @IsOptional()
  WECHAT_PAY_SERIAL_NO: string;

  @IsString()
  @IsOptional()
  WECHAT_PAY_PRIVATE_KEY: string;

  @IsString()
  @IsOptional()
  WECHAT_PAY_NOTIFY_URL: string;

  @IsString()
  @IsOptional()
  WECHAT_PAY_PUBLIC_KEY_ID: string;

  @IsString()
  @IsOptional()
  WECHAT_PAY_PUBLIC_KEY: string;
}

/** 解析 "orderNo:character_string1,amount:amount2" 为 { orderNo: 'character_string1', amount: 'amount2' } */
function parseTemplateFields(value?: string): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(value.split(',').map((pair) => pair.split(':').map((part) => part.trim())));
}

export default registerAs<WechatConfig>('wechat', () => {
  validateConfig(process.env, EnvironmentVariablesValidator);

  return {
    miniAppId: process.env.WECHAT_MINI_APP_ID ?? '',
    miniAppSecret: process.env.WECHAT_MINI_APP_SECRET ?? '',
    miniGameAppId: process.env.WECHAT_MINI_GAME_APP_ID ?? '',
    miniGameAppSecret: process.env.WECHAT_MINI_GAME_APP_SECRET ?? '',
    miniProgramState: (process.env.WECHAT_MINI_PROGRAM_STATE as WechatMiniProgramState | undefined) ?? 'formal',
    subscribeTemplates: {
      orderPaid: {
        templateId: process.env.WECHAT_SUBSCRIBE_ORDER_PAID_TEMPLATE_ID ?? '',
        fields: parseTemplateFields(process.env.WECHAT_SUBSCRIBE_ORDER_PAID_FIELDS),
      },
    },
    appId: process.env.WECHAT_APP_ID ?? '',
    appSecret: process.env.WECHAT_APP_SECRET ?? '',
    pay: {
      mchId: process.env.WECHAT_PAY_MCH_ID ?? '',
      apiV3Key: process.env.WECHAT_PAY_API_V3_KEY ?? '',
      serialNo: process.env.WECHAT_PAY_SERIAL_NO ?? '',
      privateKey: process.env.WECHAT_PAY_PRIVATE_KEY ?? '',
      notifyUrl: process.env.WECHAT_PAY_NOTIFY_URL ?? '',
      publicKeyId: process.env.WECHAT_PAY_PUBLIC_KEY_ID ?? '',
      publicKey: process.env.WECHAT_PAY_PUBLIC_KEY ?? '',
    },
  };
});
