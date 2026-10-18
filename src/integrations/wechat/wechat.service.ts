import { Injectable, Logger, UnprocessableEntityException, HttpStatus, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { AllConfigType } from '../../config/config.type';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { generateWeChatSignature } from '../../modules/shares/utils/wechat-signature.util';
import { WechatMiniProgramState } from './config/wechat-config.type';

/** 外部 API 调用默认超时时间（毫秒） */
const WECHAT_API_TIMEOUT_MS = 10_000;

const MINI_APP_ACCESS_TOKEN_CACHE_KEY = 'wechat:mini_app:access_token';

/** access_token 无效或过期的错误码，刷新 token 后可重试 */
const ACCESS_TOKEN_INVALID_ERROR_CODES = new Set([40001, 40014, 42001]);

/** 手机号 code 无效或已使用 */
const PHONE_CODE_INVALID_ERROR_CODES = new Set([40029, 40163]);

/** 微信接口返回非 0 errcode */
export class WechatApiError extends Error {
  constructor(
    readonly errcode: number,
    readonly errmsg: string,
  ) {
    super(`WeChat API error ${errcode}: ${errmsg}`);
    this.name = 'WechatApiError';
  }
}

export interface WechatPhoneInfo {
  /** 不带区号的手机号 */
  purePhoneNumber: string;
  countryCode: string;
}

export interface WechatSubscribeMessage {
  openId: string;
  templateId: string;
  /** 点击消息跳转的小程序页面，可带参数 */
  page?: string;
  /** 模板字段 key → 值 */
  data: Record<string, string>;
}

/** 内容安全检测场景值 */
export enum WechatMsgSecCheckScene {
  PROFILE = 1,
  COMMENT = 2,
  FORUM = 3,
  SOCIAL_LOG = 4,
}

export type WechatMsgSecCheckSuggest = 'pass' | 'review' | 'risky';

export interface WechatMsgSecCheckParams {
  openId: string;
  scene: WechatMsgSecCheckScene;
  /** 不超过 2500 字 */
  content: string;
}

export interface WechatMsgSecCheckResult {
  /** suggest 为 pass */
  pass: boolean;
  suggest: WechatMsgSecCheckSuggest;
  /** 命中标签，100 为正常 */
  label: number;
  traceId: string;
}

interface WechatApiResult {
  errcode?: number;
  errmsg?: string;
}

interface WechatMsgSecCheckApiResult extends WechatApiResult {
  trace_id?: string;
  result?: {
    suggest: WechatMsgSecCheckSuggest;
    label: number;
  };
}

interface WechatPhoneNumberResult extends WechatApiResult {
  phone_info?: {
    phoneNumber: string;
    purePhoneNumber: string;
    countryCode: string;
  };
}

export interface WechatUserInfo {
  openId: string;
  unionId?: string;
  sessionKey?: string;
  nickname?: string;
  avatar?: string;
  gender?: number;
}

export interface WechatMiniLoginResult {
  openid: string;
  session_key: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

export interface WechatAppTokenResult {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  openid: string;
  scope: string;
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

export interface WechatAppUserInfoResult {
  openid: string;
  nickname: string;
  sex: number;
  province: string;
  city: string;
  country: string;
  headimgurl: string;
  privilege: string[];
  unionid?: string;
  errcode?: number;
  errmsg?: string;
}

export interface WechatAccessTokenResult {
  access_token: string;
  expires_in: number;
  errcode?: number;
  errmsg?: string;
}

export interface WechatJsapiTicketResult {
  ticket: string;
  expires_in: number;
  errcode?: number;
  errmsg?: string;
}

@Injectable()
export class WechatService {
  private readonly logger = new Logger(WechatService.name);

  constructor(
    private readonly configService: ConfigService<AllConfigType>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /**
   * 封装 fetch 调用：统一超时 + 避免将含 secret 的 URL 写入日志
   * 传入 body 时以 JSON POST 发送
   */
  private async wechatFetch(url: string, label: string, body?: unknown): Promise<Response> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(WECHAT_API_TIMEOUT_MS),
      ...(body !== undefined && {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    });

    if (!response.ok) {
      this.logger.error(`${label} HTTP error: ${response.status} ${response.statusText}`);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { wechat: 'requestFailed' },
      });
    }

    return response;
  }

  /**
   * 微信小程序登录 - 通过code换取openid和session_key
   * 注意：微信 API 要求 secret 通过 GET 参数传递，此处使用 URLSearchParams 构建，
   * 并通过 wechatFetch 避免将完整 URL 写入日志。生产环境应确保反向代理不记录请求参数。
   */
  async miniAppLogin(code: string): Promise<WechatUserInfo> {
    const appId = this.configService.get('wechat.miniAppId', { infer: true });
    const appSecret = this.configService.get('wechat.miniAppSecret', { infer: true });

    if (!appId || !appSecret) {
      this.logger.error('WeChat Mini App credentials not configured');
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { wechat: 'notConfigured' },
      });
    }

    const params = new URLSearchParams({
      appid: appId,
      secret: appSecret,
      js_code: code,
      grant_type: 'authorization_code',
    });
    const url = `https://api.weixin.qq.com/sns/jscode2session?${params}`;

    try {
      const response = await this.wechatFetch(url, 'WeChat Mini App login');
      const data = (await response.json()) as WechatMiniLoginResult;

      if (data.errcode) {
        this.logger.error(`WeChat Mini App login failed: ${data.errcode} - ${data.errmsg}`);
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: { code: 'invalidCode', wechatError: data.errmsg },
        });
      }

      this.logger.log(`WeChat Mini App login successful for openid: ${data.openid}`);

      return {
        openId: data.openid,
        unionId: data.unionid,
        sessionKey: data.session_key,
      };
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        throw error;
      }
      this.logger.error('WeChat Mini App login request failed', error);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { wechat: 'requestFailed' },
      });
    }
  }

  /**
   * 微信APP登录 - 通过code换取access_token和openid
   */
  async appLogin(code: string): Promise<WechatUserInfo> {
    const appId = this.configService.get('wechat.appId', { infer: true });
    const appSecret = this.configService.get('wechat.appSecret', { infer: true });

    if (!appId || !appSecret) {
      this.logger.error('WeChat App credentials not configured');
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { wechat: 'notConfigured' },
      });
    }

    const tokenParams = new URLSearchParams({
      appid: appId,
      secret: appSecret,
      code,
      grant_type: 'authorization_code',
    });
    const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?${tokenParams}`;

    try {
      // Step 1: Exchange code for access_token
      const tokenResponse = await this.wechatFetch(tokenUrl, 'WeChat App token');
      const tokenData = (await tokenResponse.json()) as WechatAppTokenResult;

      if (tokenData.errcode) {
        this.logger.error(`WeChat App token exchange failed: ${tokenData.errcode} - ${tokenData.errmsg}`);
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: { code: 'invalidCode', wechatError: tokenData.errmsg },
        });
      }

      // Step 2: Get user info using access_token (access_token 非长期密钥，可出现在 URL 中)
      const userInfoParams = new URLSearchParams({
        access_token: tokenData.access_token,
        openid: tokenData.openid,
      });
      const userInfoUrl = `https://api.weixin.qq.com/sns/userinfo?${userInfoParams}`;
      const userInfoResponse = await this.wechatFetch(userInfoUrl, 'WeChat App user info');
      const userInfoData = (await userInfoResponse.json()) as WechatAppUserInfoResult;

      if (userInfoData.errcode) {
        this.logger.error(`WeChat App user info failed: ${userInfoData.errcode} - ${userInfoData.errmsg}`);
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: { wechat: 'userInfoFailed', wechatError: userInfoData.errmsg },
        });
      }

      this.logger.log(`WeChat App login successful for openid: ${tokenData.openid}`);

      return {
        openId: tokenData.openid,
        unionId: userInfoData.unionid ?? tokenData.unionid,
        nickname: userInfoData.nickname,
        avatar: userInfoData.headimgurl,
        gender: userInfoData.sex,
      };
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        throw error;
      }
      this.logger.error('WeChat App login request failed', error);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { wechat: 'requestFailed' },
      });
    }
  }

  /**
   * 获取微信公众号 access_token（带缓存）
   */
  async getAccessToken(): Promise<string> {
    const cacheKey = 'wechat:access_token';
    const cached = await this.cacheManager.get<string>(cacheKey);

    if (cached) {
      return cached;
    }

    const appId = this.configService.get('wechat.appId', { infer: true });
    const appSecret = this.configService.get('wechat.appSecret', { infer: true });

    if (!appId || !appSecret) {
      this.logger.error('WeChat credentials not configured');
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { wechat: 'notConfigured' },
      });
    }

    const params = new URLSearchParams({
      grant_type: 'client_credential',
      appid: appId,
      secret: appSecret,
    });
    const url = `https://api.weixin.qq.com/cgi-bin/token?${params}`;

    try {
      const response = await this.wechatFetch(url, 'Get access_token');
      const data = (await response.json()) as WechatAccessTokenResult;

      if (data.errcode) {
        this.logger.error(`Get access_token failed: ${data.errcode} - ${data.errmsg}`);
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: { wechat: 'accessTokenFailed', wechatError: data.errmsg },
        });
      }

      // Cache for 7000 seconds (expires_in is 7200, use 7000 for safety)
      await this.cacheManager.set(cacheKey, data.access_token, 7000 * 1000);

      return data.access_token;
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        throw error;
      }
      this.logger.error('Get access_token request failed', error);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { wechat: 'requestFailed' },
      });
    }
  }

  /**
   * 获取小程序 access_token（stable_token 普通模式，带缓存）
   */
  async getMiniAppAccessToken(): Promise<string> {
    const cached = await this.cacheManager.get<string>(MINI_APP_ACCESS_TOKEN_CACHE_KEY);
    if (cached) {
      return cached;
    }
    return this.fetchStableToken(false);
  }

  /**
   * token 失效后重新获取：普通模式仍返回同一个 token 时才强制刷新
   */
  private async refreshMiniAppAccessToken(invalidToken: string): Promise<string> {
    await this.cacheManager.del(MINI_APP_ACCESS_TOKEN_CACHE_KEY);
    const token = await this.fetchStableToken(false);
    return token === invalidToken ? this.fetchStableToken(true) : token;
  }

  private async fetchStableToken(forceRefresh: boolean): Promise<string> {
    const appId = this.configService.get('wechat.miniAppId', { infer: true });
    const appSecret = this.configService.get('wechat.miniAppSecret', { infer: true });

    if (!appId || !appSecret) {
      this.logger.error('WeChat Mini App credentials not configured');
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { wechat: 'notConfigured' },
      });
    }

    const response = await this.wechatFetch('https://api.weixin.qq.com/cgi-bin/stable_token', 'Get stable_token', {
      grant_type: 'client_credential',
      appid: appId,
      secret: appSecret,
      force_refresh: forceRefresh,
    });
    const data = (await response.json()) as WechatAccessTokenResult;

    if (data.errcode) {
      this.logger.error(`Get stable_token failed: ${data.errcode} - ${data.errmsg}`);
      throw new WechatApiError(data.errcode, data.errmsg ?? '');
    }

    // expires_in 为剩余有效期
    const ttlSeconds = data.expires_in > 600 ? data.expires_in - 300 : Math.floor(data.expires_in / 2);
    if (ttlSeconds > 0) {
      await this.cacheManager.set(MINI_APP_ACCESS_TOKEN_CACHE_KEY, data.access_token, ttlSeconds * 1000);
    }

    return data.access_token;
  }

  /**
   * 以小程序 access_token 调用微信服务端接口，token 失效时刷新并重试一次
   * @throws WechatApiError 微信返回非 0 errcode
   */
  private async callMiniAppApi<T extends WechatApiResult>(path: string, body: unknown, label: string): Promise<T> {
    const request = async (accessToken: string): Promise<T> => {
      const url = `https://api.weixin.qq.com${path}?${new URLSearchParams({ access_token: accessToken })}`;
      const response = await this.wechatFetch(url, label, body);
      return (await response.json()) as T;
    };

    const accessToken = await this.getMiniAppAccessToken();
    let data = await request(accessToken);

    if (data.errcode && ACCESS_TOKEN_INVALID_ERROR_CODES.has(data.errcode)) {
      this.logger.warn(`${label}: access_token invalid (${data.errcode}), refreshing`);
      data = await request(await this.refreshMiniAppAccessToken(accessToken));
    }

    if (data.errcode) {
      throw new WechatApiError(data.errcode, data.errmsg ?? '');
    }

    return data;
  }

  /**
   * 用手机号快速验证组件返回的 code 换取用户手机号
   * @throws UnprocessableEntityException code 无效时为 invalidPhoneCode，配置缺失或请求微信失败时为 wechat 字段错误
   */
  async getPhoneNumber(code: string): Promise<WechatPhoneInfo> {
    try {
      const data = await this.callMiniAppApi<WechatPhoneNumberResult>(
        '/wxa/business/getuserphonenumber',
        { code },
        'Get phone number',
      );

      if (!data.phone_info?.purePhoneNumber) {
        throw new WechatApiError(-1, 'phone_info missing');
      }

      return {
        purePhoneNumber: data.phone_info.purePhoneNumber,
        countryCode: data.phone_info.countryCode,
      };
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        throw error;
      }
      this.logger.error(`Get phone number failed: ${error instanceof Error ? error.message : error}`);
      if (error instanceof WechatApiError && PHONE_CODE_INVALID_ERROR_CODES.has(error.errcode)) {
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          error: 'invalidPhoneCode',
          errors: { phoneCode: 'invalidCode' },
        });
      }
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { wechat: 'requestFailed' },
      });
    }
  }

  /**
   * 发送小程序订阅消息
   * @throws WechatApiError 微信返回非 0 errcode（如 43101 用户未订阅）
   */
  async sendSubscribeMessage(message: WechatSubscribeMessage): Promise<void> {
    const miniProgramState: WechatMiniProgramState =
      this.configService.get('wechat.miniProgramState', { infer: true }) ?? 'formal';

    await this.callMiniAppApi<WechatApiResult>(
      '/cgi-bin/message/subscribe/send',
      {
        touser: message.openId,
        template_id: message.templateId,
        page: message.page,
        data: Object.fromEntries(Object.entries(message.data).map(([key, value]) => [key, { value }])),
        miniprogram_state: miniProgramState,
        lang: 'zh_CN',
      },
      'Send subscribe message',
    );
  }

  /**
   * 文本内容安全检测（msgSecCheck v2）
   * @throws WechatApiError 微信返回非 0 errcode 或缺少检测结果
   * @throws UnprocessableEntityException 小程序凭证未配置（notConfigured）或微信返回非 2xx（requestFailed）
   * @throws DOMException 请求超时（TimeoutError）
   * @throws TypeError 网络错误
   */
  async msgSecCheck({ openId, scene, content }: WechatMsgSecCheckParams): Promise<WechatMsgSecCheckResult> {
    const data = await this.callMiniAppApi<WechatMsgSecCheckApiResult>(
      '/wxa/msg_sec_check',
      { content, version: 2, scene, openid: openId },
      'Message security check',
    );

    if (!data.result) {
      throw new WechatApiError(-1, 'result missing');
    }

    return {
      pass: data.result.suggest === 'pass',
      suggest: data.result.suggest,
      label: data.result.label,
      traceId: data.trace_id ?? '',
    };
  }

  /**
   * 获取微信 jsapi_ticket（带缓存）
   */
  async getJsapiTicket(): Promise<string> {
    const cacheKey = 'wechat:jsapi_ticket';
    const cached = await this.cacheManager.get<string>(cacheKey);

    if (cached) {
      return cached;
    }

    const accessToken = await this.getAccessToken();
    const params = new URLSearchParams({
      access_token: accessToken,
      type: 'jsapi',
    });
    const url = `https://api.weixin.qq.com/cgi-bin/ticket/getticket?${params}`;

    try {
      const response = await this.wechatFetch(url, 'Get jsapi_ticket');
      const data = (await response.json()) as WechatJsapiTicketResult;

      if (data.errcode && data.errcode !== 0) {
        this.logger.error(`Get jsapi_ticket failed: ${data.errcode} - ${data.errmsg}`);
        throw new UnprocessableEntityException({
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          errors: { wechat: 'jsapiTicketFailed', wechatError: data.errmsg },
        });
      }

      // Cache for 7000 seconds (expires_in is 7200, use 7000 for safety)
      await this.cacheManager.set(cacheKey, data.ticket, 7000 * 1000);

      return data.ticket;
    } catch (error) {
      if (error instanceof UnprocessableEntityException) {
        throw error;
      }
      this.logger.error('Get jsapi_ticket request failed', error);
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { wechat: 'requestFailed' },
      });
    }
  }

  /**
   * 获取微信 JS-SDK 配置
   */
  async getJsSdkConfig(url: string): Promise<{
    appId: string;
    timestamp: string;
    nonceStr: string;
    signature: string;
  }> {
    const appId = this.configService.get('wechat.appId', { infer: true });

    if (!appId) {
      this.logger.error('WeChat App ID not configured');
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: {
          wechat: 'notConfigured',
        },
      });
    }

    const jsapiTicket = await this.getJsapiTicket();
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = this.generateNonceStr();
    const signature = generateWeChatSignature(jsapiTicket, nonceStr, timestamp, url);

    return {
      appId,
      timestamp,
      nonceStr,
      signature,
    };
  }

  /**
   * 生成加密安全的随机字符串
   */
  private generateNonceStr(length: number = 16): string {
    return randomBytes(Math.ceil(length / 2))
      .toString('hex')
      .slice(0, length);
  }
}
