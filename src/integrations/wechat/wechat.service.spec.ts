import { UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';
import { AllConfigType } from '../../config/config.type';
import { WechatApiError, WechatMsgSecCheckScene, WechatService } from './wechat.service';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function createService() {
  const store = new Map<string, unknown>();
  const cache = {
    get: vi.fn((key: string) => Promise.resolve(store.get(key))),
    set: vi.fn((key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    del: vi.fn((key: string) => {
      store.delete(key);
      return Promise.resolve(true);
    }),
  };
  const config: Record<string, unknown> = {
    'wechat.miniAppId': 'wx-app',
    'wechat.miniAppSecret': 'secret',
    'wechat.miniProgramState': 'trial',
  };
  const configService = { get: vi.fn((key: string) => config[key]) };
  const service = new WechatService(
    configService as unknown as ConfigService<AllConfigType>,
    cache as unknown as Cache,
  );
  return { service, store, config, cache };
}

describe('WechatService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function requestBody(call: number): Record<string, unknown> {
    return JSON.parse((fetchMock.mock.calls[call][1] as RequestInit).body as string) as Record<string, unknown>;
  }

  describe('getMiniAppAccessToken', () => {
    it('should fetch a stable token and reuse it from cache', async () => {
      const { service } = createService();
      fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'T1', expires_in: 7200 }));

      await expect(service.getMiniAppAccessToken()).resolves.toBe('T1');
      await expect(service.getMiniAppAccessToken()).resolves.toBe('T1');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.weixin.qq.com/cgi-bin/stable_token');
      expect(requestBody(0)).toEqual({
        grant_type: 'client_credential',
        appid: 'wx-app',
        secret: 'secret',
        force_refresh: false,
      });
    });

    it('should cache a short-lived token for half of its remaining lifetime', async () => {
      const { service, cache } = createService();
      fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'T1', expires_in: 100 }));

      await service.getMiniAppAccessToken();

      expect(cache.set).toHaveBeenCalledWith('wechat:mini_app:access_token', 'T1', 50_000);
    });

    it('should throw WechatApiError when WeChat returns an errcode', async () => {
      const { service } = createService();
      fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 40013, errmsg: 'invalid appid' }));

      await expect(service.getMiniAppAccessToken()).rejects.toBeInstanceOf(WechatApiError);
    });
  });

  describe('getPhoneNumber', () => {
    it('should return the phone number for the code', async () => {
      const { service, store } = createService();
      store.set('wechat:mini_app:access_token', 'T1');
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          errcode: 0,
          phone_info: { phoneNumber: '13800000000', purePhoneNumber: '13800000000', countryCode: '86' },
        }),
      );

      await expect(service.getPhoneNumber('P1')).resolves.toEqual({
        purePhoneNumber: '13800000000',
        countryCode: '86',
      });
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=T1',
      );
      expect(requestBody(0)).toEqual({ code: 'P1' });
    });

    it('should fetch the current token without force refresh and retry once when the token is invalid', async () => {
      const { service, store } = createService();
      store.set('wechat:mini_app:access_token', 'EXPIRED');
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ errcode: 40001, errmsg: 'invalid credential' }))
        .mockResolvedValueOnce(jsonResponse({ access_token: 'T2', expires_in: 7200 }))
        .mockResolvedValueOnce(
          jsonResponse({ errcode: 0, phone_info: { purePhoneNumber: '13800000000', countryCode: '86' } }),
        );

      await expect(service.getPhoneNumber('P1')).resolves.toMatchObject({ purePhoneNumber: '13800000000' });
      expect(requestBody(1)).toMatchObject({ force_refresh: false });
      expect(fetchMock.mock.calls[2][0]).toContain('access_token=T2');
    });

    it('should force refresh only when the normal mode returns the same invalid token', async () => {
      const { service, store } = createService();
      store.set('wechat:mini_app:access_token', 'T1');
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ errcode: 40001, errmsg: 'invalid credential' }))
        .mockResolvedValueOnce(jsonResponse({ access_token: 'T1', expires_in: 3000 }))
        .mockResolvedValueOnce(jsonResponse({ access_token: 'T2', expires_in: 7200 }))
        .mockResolvedValueOnce(
          jsonResponse({ errcode: 0, phone_info: { purePhoneNumber: '13800000000', countryCode: '86' } }),
        );

      await service.getPhoneNumber('P1');

      expect(requestBody(1)).toMatchObject({ force_refresh: false });
      expect(requestBody(2)).toMatchObject({ force_refresh: true });
      expect(fetchMock.mock.calls[3][0]).toContain('access_token=T2');
    });

    it('should report a WeChat request failure when the access token cannot be obtained', async () => {
      const { service } = createService();
      fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 40125, errmsg: 'invalid secret' }));

      const error = await service.getPhoneNumber('P1').catch((e: unknown) => e);

      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        errors: { wechat: 'requestFailed' },
      });
    });

    it('should pass through the not configured error', async () => {
      const { service, config } = createService();
      config['wechat.miniAppSecret'] = '';

      const error = await service.getPhoneNumber('P1').catch((e: unknown) => e);

      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        errors: { wechat: 'notConfigured' },
      });
    });

    it('should reject an invalid code with a field error', async () => {
      const { service, store } = createService();
      store.set('wechat:mini_app:access_token', 'T1');
      fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 40029, errmsg: 'invalid code' }));

      const error = await service.getPhoneNumber('BAD').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
        errors: { phoneCode: 'invalidCode' },
      });
    });
  });

  describe('sendSubscribeMessage', () => {
    it('should send the template data with the configured mini program state', async () => {
      const { service, store } = createService();
      store.set('wechat:mini_app:access_token', 'T1');
      fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

      await service.sendSubscribeMessage({
        openId: 'OPEN1',
        templateId: 'TPL1',
        page: 'pages/index/index',
        data: { character_string1: 'ORD1' },
      });

      expect(requestBody(0)).toEqual({
        touser: 'OPEN1',
        template_id: 'TPL1',
        page: 'pages/index/index',
        data: { character_string1: { value: 'ORD1' } },
        miniprogram_state: 'trial',
        lang: 'zh_CN',
      });
    });

    it('should throw WechatApiError with the errcode when the user has not subscribed', async () => {
      const { service, store } = createService();
      store.set('wechat:mini_app:access_token', 'T1');
      fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 43101, errmsg: 'user refuse to accept the msg' }));

      const error = await service
        .sendSubscribeMessage({ openId: 'OPEN1', templateId: 'TPL1', data: {} })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(WechatApiError);
      expect((error as WechatApiError).errcode).toBe(43101);
    });
  });

  describe('msgSecCheck', () => {
    const params = { openId: 'OPEN1', scene: WechatMsgSecCheckScene.FORUM, content: '这道题怎么做' };

    it('should send a v2 check request and return pass for suggest pass', async () => {
      const { service, store } = createService();
      store.set('wechat:mini_app:access_token', 'T1');
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ errcode: 0, errmsg: 'ok', trace_id: 'TR1', result: { suggest: 'pass', label: 100 } }),
      );

      await expect(service.msgSecCheck(params)).resolves.toEqual({
        pass: true,
        suggest: 'pass',
        label: 100,
        traceId: 'TR1',
      });
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.weixin.qq.com/wxa/msg_sec_check?access_token=T1');
      expect(requestBody(0)).toEqual({ content: '这道题怎么做', version: 2, scene: 3, openid: 'OPEN1' });
    });

    it.each(['risky', 'review'])('should not pass when suggest is %s', async (suggest) => {
      const { service, store } = createService();
      store.set('wechat:mini_app:access_token', 'T1');
      fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, trace_id: 'TR2', result: { suggest, label: 20001 } }));

      await expect(service.msgSecCheck(params)).resolves.toEqual({
        pass: false,
        suggest,
        label: 20001,
        traceId: 'TR2',
      });
    });

    it('should refresh the token and retry once when the token is invalid', async () => {
      const { service, store } = createService();
      store.set('wechat:mini_app:access_token', 'EXPIRED');
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ errcode: 42001, errmsg: 'access_token expired' }))
        .mockResolvedValueOnce(jsonResponse({ access_token: 'T2', expires_in: 7200 }))
        .mockResolvedValueOnce(jsonResponse({ errcode: 0, trace_id: 'TR3', result: { suggest: 'pass', label: 100 } }));

      await expect(service.msgSecCheck(params)).resolves.toMatchObject({ pass: true });
      expect(fetchMock.mock.calls[2][0]).toBe('https://api.weixin.qq.com/wxa/msg_sec_check?access_token=T2');
    });

    it('should throw WechatApiError when WeChat returns an errcode', async () => {
      const { service, store } = createService();
      store.set('wechat:mini_app:access_token', 'T1');
      fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 40003, errmsg: 'invalid openid' }));

      const error = await service.msgSecCheck(params).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(WechatApiError);
      expect((error as WechatApiError).errcode).toBe(40003);
    });

    it('should throw UnprocessableEntityException when WeChat responds with a non-2xx status', async () => {
      const { service, store } = createService();
      store.set('wechat:mini_app:access_token', 'T1');
      fetchMock.mockResolvedValueOnce(new Response('Bad Gateway', { status: 502 }));

      await expect(service.msgSecCheck(params)).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('should throw WechatApiError when the result is missing', async () => {
      const { service, store } = createService();
      store.set('wechat:mini_app:access_token', 'T1');
      fetchMock.mockResolvedValueOnce(jsonResponse({ errcode: 0, errmsg: 'ok' }));

      await expect(service.msgSecCheck(params)).rejects.toBeInstanceOf(WechatApiError);
    });
  });
});
