import type { Mocked } from 'vitest';
import { NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { SessionService } from '../session/session.service';
import { UsersService } from '../users/users.service';
import { TokenService } from './services/token.service';
import { StatusEnum } from '../../common/enums/statuses/statuses.enum';
import { WechatService } from '../../integrations/wechat/wechat.service';
import { AlipayService } from '../../integrations/alipay/alipay.service';
import { AuthProvidersEnum } from './auth-providers.enum';
import { NotificationsService } from '../../modules/notifications/notifications.service';
import { User } from '../users/domain/user';
import { MailService } from '../../integrations/mail/mail.service';
import { SmsCodeType, SmsService } from '../../integrations/sms/sms.service';
import { hashPassword } from '../../common/utils/crypto.utils';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { requestContextMiddleware } from '../../common/request-context';
import { JwtPayloadType } from './strategies/types/jwt-payload.type';

describe('AuthService', () => {
  describe('refreshToken', () => {
    let sessionService: Mocked<Pick<SessionService, 'findById' | 'rotateHash' | 'wasRecentlyRotatedFrom' | 'revoke'>>;
    let tokenService: Mocked<Pick<TokenService, 'generateSessionHash' | 'getTokensData'>>;
    let service: AuthService;

    beforeEach(async () => {
      sessionService = {
        findById: vi.fn().mockResolvedValue({ id: 10, hash: 'H1', user: { id: 1 } }),
        rotateHash: vi.fn().mockResolvedValue(true),
        wasRecentlyRotatedFrom: vi.fn().mockResolvedValue(false),
        revoke: vi.fn(),
      };
      tokenService = {
        generateSessionHash: vi.fn().mockReturnValue('H2'),
        getTokensData: vi.fn().mockResolvedValue({ token: 't', refreshToken: 'r', tokenExpires: 1 }),
      };
      const usersService = {
        findById: vi.fn().mockResolvedValue({ id: 1, role: { id: 2 }, status: { id: StatusEnum.active } }),
      };

      const moduleRef = await Test.createTestingModule({ providers: [AuthService] })
        .useMocker((token) => {
          if (token === SessionService) return sessionService;
          if (token === TokenService) return tokenService;
          if (token === UsersService) return usersService;
          return {};
        })
        .compile();
      service = moduleRef.get(AuthService);
    });

    it('should issue new tokens and rotate the session hash', async () => {
      await expect(service.refreshToken({ sessionId: 10, hash: 'H1' })).resolves.toEqual({
        token: 't',
        refreshToken: 'r',
        tokenExpires: 1,
      });
      expect(sessionService.rotateHash).toHaveBeenCalledWith(10, 'H1', 'H2');
    });

    it('should keep the session hash when signing the new tokens fails', async () => {
      tokenService.getTokensData.mockRejectedValue(new Error('sign failed'));

      await expect(service.refreshToken({ sessionId: 10, hash: 'H1' })).rejects.toThrow('sign failed');
      expect(sessionService.rotateHash).not.toHaveBeenCalled();
    });

    it('should revoke the session when an old refresh token is presented after the grace period', async () => {
      await expect(service.refreshToken({ sessionId: 10, hash: 'H0' })).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessionService.revoke).toHaveBeenCalledWith(10);
    });

    it('should reject without revoking when the refresh token was rotated moments ago', async () => {
      sessionService.wasRecentlyRotatedFrom.mockResolvedValue(true);

      await expect(service.refreshToken({ sessionId: 10, hash: 'H0' })).rejects.toBeInstanceOf(UnauthorizedException);
      expect(sessionService.revoke).not.toHaveBeenCalled();
    });

    it('should reject when another refresh rotated the hash first', async () => {
      sessionService.rotateHash.mockResolvedValue(false);

      await expect(service.refreshToken({ sessionId: 10, hash: 'H1' })).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('wechatPhoneLogin', () => {
    const dto = { loginCode: 'L1', phoneCode: 'P1' };
    const PHONE = '13800000000';

    let usersService: Mocked<
      Pick<
        UsersService,
        'findByWechatOpenId' | 'findByPhone' | 'findById' | 'create' | 'bindPhoneIfEmpty' | 'bindWechatIfEmpty'
      >
    >;
    let wechatService: Mocked<Pick<WechatService, 'miniAppLogin' | 'getPhoneNumber'>>;
    let notificationsService: Mocked<Pick<NotificationsService, 'initializeDefaultSettings'>>;
    let service: AuthService;

    function buildUser(overrides: Partial<User> = {}): User {
      return { id: 1, role: { id: 2 }, status: { id: StatusEnum.active }, ...overrides } as User;
    }

    function rejectionErrors(error: unknown): unknown {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      return ((error as UnprocessableEntityException).getResponse() as { errors: unknown }).errors;
    }

    beforeEach(async () => {
      usersService = {
        findByWechatOpenId: vi.fn().mockResolvedValue(null),
        findByPhone: vi.fn().mockResolvedValue(null),
        findById: vi.fn(),
        create: vi.fn(),
        bindPhoneIfEmpty: vi.fn().mockResolvedValue(true),
        bindWechatIfEmpty: vi.fn().mockResolvedValue(true),
      };
      wechatService = {
        miniAppLogin: vi.fn().mockResolvedValue({ openId: 'OPEN1', unionId: 'UNION1' }),
        getPhoneNumber: vi.fn().mockResolvedValue({ purePhoneNumber: PHONE, countryCode: '86' }),
      };
      notificationsService = { initializeDefaultSettings: vi.fn() };
      const sessionService = { create: vi.fn().mockResolvedValue({ id: 10 }) };
      const tokenService = {
        generateSessionHash: vi.fn().mockReturnValue('H'),
        getTokensData: vi.fn().mockResolvedValue({ token: 't', refreshToken: 'r', tokenExpires: 1 }),
      };

      const moduleRef = await Test.createTestingModule({ providers: [AuthService] })
        .useMocker((token) => {
          if (token === UsersService) return usersService;
          if (token === WechatService) return wechatService;
          if (token === NotificationsService) return notificationsService;
          if (token === SessionService) return sessionService;
          if (token === TokenService) return tokenService;
          return {};
        })
        .compile();
      service = moduleRef.get(AuthService);
    });

    it('should create a user with both the openId and the phone when neither exists', async () => {
      usersService.create.mockResolvedValue(buildUser({ id: 5 }));

      const result = await service.wechatPhoneLogin(dto);

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ wechatOpenId: 'OPEN1', wechatUnionId: 'UNION1', phone: PHONE }),
      );
      expect(notificationsService.initializeDefaultSettings).toHaveBeenCalledWith(5);
      expect(result.user.id).toBe(5);
    });

    it('should bind the phone to the WeChat user without a phone', async () => {
      usersService.findByWechatOpenId.mockResolvedValue(buildUser({ id: 1, phone: null }));
      usersService.findById.mockResolvedValue(buildUser({ id: 1, phone: PHONE }));

      const result = await service.wechatPhoneLogin(dto);

      expect(usersService.bindPhoneIfEmpty).toHaveBeenCalledWith(1, PHONE);
      expect(result.user.phone).toBe(PHONE);
    });

    it('should keep the existing phone of the WeChat user', async () => {
      usersService.findByWechatOpenId.mockResolvedValue(buildUser({ id: 1, phone: '13900000000' }));

      const result = await service.wechatPhoneLogin(dto);

      expect(usersService.bindPhoneIfEmpty).not.toHaveBeenCalled();
      expect(result.user.phone).toBe('13900000000');
    });

    it('should bind the WeChat account to the phone user without a WeChat account', async () => {
      usersService.findByPhone.mockResolvedValue(buildUser({ id: 2, phone: PHONE, wechatOpenId: null }));
      usersService.findById.mockResolvedValue(buildUser({ id: 2, phone: PHONE, wechatOpenId: 'OPEN1' }));

      const result = await service.wechatPhoneLogin(dto);

      expect(usersService.bindWechatIfEmpty).toHaveBeenCalledWith(2, 'OPEN1', 'UNION1');
      expect(result.user.id).toBe(2);
    });

    it('should log in when the openId and the phone belong to the same user', async () => {
      const user = buildUser({ id: 3, phone: PHONE, wechatOpenId: 'OPEN1' });
      usersService.findByWechatOpenId.mockResolvedValue(user);
      usersService.findByPhone.mockResolvedValue(user);

      const result = await service.wechatPhoneLogin(dto);

      expect(result.user.id).toBe(3);
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('should reject when the openId and the phone belong to different users', async () => {
      usersService.findByWechatOpenId.mockResolvedValue(buildUser({ id: 1 }));
      usersService.findByPhone.mockResolvedValue(buildUser({ id: 2, phone: PHONE }));

      const error = await service.wechatPhoneLogin(dto).catch((e: unknown) => e);

      expect(rejectionErrors(error)).toEqual({ phone: 'boundToOtherWechat' });
    });

    it('should reject when the phone user is bound to another WeChat account', async () => {
      usersService.findByPhone.mockResolvedValue(buildUser({ id: 2, phone: PHONE, wechatOpenId: 'OPEN2' }));

      const error = await service.wechatPhoneLogin(dto).catch((e: unknown) => e);

      expect(rejectionErrors(error)).toEqual({ phone: 'boundToOtherWechat' });
      expect(usersService.bindWechatIfEmpty).not.toHaveBeenCalled();
    });

    it('should not bind the WeChat account to a phone user whose status does not allow login', async () => {
      usersService.findByPhone.mockResolvedValue(
        buildUser({ id: 2, phone: PHONE, wechatOpenId: null, status: { id: 99 } }),
      );

      const error = await service.wechatPhoneLogin(dto).catch((e: unknown) => e);

      expect(rejectionErrors(error)).toEqual({ wechat: 'userNotActive' });
      expect(usersService.bindWechatIfEmpty).not.toHaveBeenCalled();
    });

    it('should reject phone numbers outside mainland China', async () => {
      wechatService.getPhoneNumber.mockResolvedValue({ purePhoneNumber: '91234567', countryCode: '852' });

      const error = await service.wechatPhoneLogin(dto).catch((e: unknown) => e);

      expect(rejectionErrors(error)).toEqual({ phone: 'unsupportedRegion' });
    });

    it('should look up again when a concurrent request created the user first', async () => {
      const created = buildUser({ id: 7, phone: PHONE, wechatOpenId: 'OPEN1' });
      usersService.create.mockRejectedValue(new Error('duplicate key'));
      usersService.findByWechatOpenId.mockResolvedValueOnce(null).mockResolvedValueOnce(created);
      usersService.findByPhone.mockResolvedValueOnce(null).mockResolvedValueOnce(created);

      const result = await service.wechatPhoneLogin(dto);

      expect(result.user.id).toBe(7);
    });

    it('should throw when the second attempt still conflicts', async () => {
      usersService.create.mockRejectedValue(new Error('duplicate key'));

      await expect(service.wechatPhoneLogin(dto)).rejects.toThrow('duplicate key');
      expect(usersService.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('alipayLogin', () => {
    const dto = { authCode: 'A1' };

    let usersService: Mocked<Pick<UsersService, 'findByAlipayOpenId' | 'create'>>;
    let alipayService: Mocked<Pick<AlipayService, 'exchangeAuthCode'>>;
    let notificationsService: Mocked<Pick<NotificationsService, 'initializeDefaultSettings'>>;
    let service: AuthService;

    function buildUser(overrides: Partial<User> = {}): User {
      return { id: 1, role: { id: 2 }, status: { id: StatusEnum.active }, ...overrides } as User;
    }

    beforeEach(async () => {
      usersService = {
        findByAlipayOpenId: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      };
      alipayService = { exchangeAuthCode: vi.fn().mockResolvedValue({ openId: 'ALI1' }) };
      notificationsService = { initializeDefaultSettings: vi.fn() };
      const sessionService = { create: vi.fn().mockResolvedValue({ id: 10 }) };
      const tokenService = {
        generateSessionHash: vi.fn().mockReturnValue('H'),
        getTokensData: vi.fn().mockResolvedValue({ token: 't', refreshToken: 'r', tokenExpires: 1 }),
      };

      const moduleRef = await Test.createTestingModule({ providers: [AuthService] })
        .useMocker((token) => {
          if (token === UsersService) return usersService;
          if (token === AlipayService) return alipayService;
          if (token === NotificationsService) return notificationsService;
          if (token === SessionService) return sessionService;
          if (token === TokenService) return tokenService;
          return {};
        })
        .compile();
      service = moduleRef.get(AuthService);
    });

    it('should log in the user bound to the Alipay openId', async () => {
      usersService.findByAlipayOpenId.mockResolvedValue(buildUser({ id: 3, alipayOpenId: 'ALI1' }));

      const result = await service.alipayLogin(dto);

      expect(alipayService.exchangeAuthCode).toHaveBeenCalledWith('A1');
      expect(result.user.id).toBe(3);
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('should create an Alipay user and initialize notification settings on first login', async () => {
      usersService.create.mockResolvedValue(buildUser({ id: 5 }));

      const result = await service.alipayLogin(dto);

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ alipayOpenId: 'ALI1', provider: AuthProvidersEnum.alipay }),
      );
      expect(notificationsService.initializeDefaultSettings).toHaveBeenCalledWith(5);
      expect(result.user.id).toBe(5);
    });

    it('should use the user created by a concurrent first login', async () => {
      usersService.create.mockRejectedValue(
        Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'user_alipayOpenId_key' }),
      );
      usersService.findByAlipayOpenId.mockResolvedValueOnce(null).mockResolvedValueOnce(buildUser({ id: 7 }));

      const result = await service.alipayLogin(dto);

      expect(result.user.id).toBe(7);
    });

    it('should reject a user whose status does not allow login', async () => {
      usersService.findByAlipayOpenId.mockResolvedValue(buildUser({ status: { id: 99 } }));

      await expect(service.alipayLogin(dto)).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('identity verification', () => {
    const OLD_PASSWORD = '5f4dcc3b5aa765d61d8327deb882cf99';
    const PHONE = '13800000000';
    const payload = { id: 1, role: { id: 2 }, sessionId: 10, iat: 0, exp: 0 };

    let usersService: Mocked<Pick<UsersService, 'findById' | 'findByEmail' | 'update' | 'remove'>>;
    let smsService: Mocked<Pick<SmsService, 'verifyCode'>>;
    let mailService: Mocked<Pick<MailService, 'confirmNewEmail'>>;
    let sessionService: Mocked<Pick<SessionService, 'deleteByUserId'>>;
    let service: AuthService;

    function rejectionErrors(error: unknown): unknown {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      return ((error as UnprocessableEntityException).getResponse() as { errors: unknown }).errors;
    }

    async function useUser(overrides: Partial<User>): Promise<void> {
      usersService.findById.mockResolvedValue({ id: 1, email: 'old@example.com', ...overrides } as User);
    }

    beforeEach(async () => {
      usersService = {
        findById: vi.fn(),
        findByEmail: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        remove: vi.fn(),
      };
      smsService = { verifyCode: vi.fn().mockResolvedValue({ success: true }) };
      mailService = { confirmNewEmail: vi.fn() };
      sessionService = { deleteByUserId: vi.fn() };
      const jwtService = { signAsync: vi.fn().mockResolvedValue('hash') };
      const configService = { getOrThrow: vi.fn().mockReturnValue('value') };

      const moduleRef = await Test.createTestingModule({ providers: [AuthService] })
        .useMocker((token) => {
          if (token === UsersService) return usersService;
          if (token === SmsService) return smsService;
          if (token === MailService) return mailService;
          if (token === SessionService) return sessionService;
          if (token === JwtService) return jwtService;
          if (token === ConfigService) return configService;
          return {};
        })
        .compile();
      service = moduleRef.get(AuthService);
    });

    it('should require the current password to change the email of a user with a password', async () => {
      await useUser({ password: await hashPassword(OLD_PASSWORD) });

      const error = await service.update(payload, { email: 'new@example.com' }).catch((e: unknown) => e);

      expect(rejectionErrors(error)).toEqual({ oldPassword: 'missingOldPassword' });
      expect(mailService.confirmNewEmail).not.toHaveBeenCalled();
    });

    it('should reject an incorrect current password when changing the email', async () => {
      await useUser({ password: await hashPassword(OLD_PASSWORD) });

      const error = await service
        .update(payload, { email: 'new@example.com', oldPassword: 'e10adc3949ba59abbe56e057f20f883e' })
        .catch((e: unknown) => e);

      expect(rejectionErrors(error)).toEqual({ oldPassword: 'incorrectOldPassword' });
      expect(mailService.confirmNewEmail).not.toHaveBeenCalled();
    });

    it('should send the confirmation mail after the current password is verified', async () => {
      await useUser({ password: await hashPassword(OLD_PASSWORD) });

      await service.update(payload, { email: 'new@example.com', oldPassword: OLD_PASSWORD });

      expect(mailService.confirmNewEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'new@example.com' }));
    });

    it('should require an SMS code to change the email of a user without a password', async () => {
      await useUser({ password: undefined, phone: PHONE });

      const error = await service.update(payload, { email: 'new@example.com' }).catch((e: unknown) => e);

      expect(rejectionErrors(error)).toEqual({ smsCode: 'missingSmsCode' });
    });

    it('should verify the SMS code against the bound phone when changing the email', async () => {
      await useUser({ password: undefined, phone: PHONE });

      await service.update(payload, { email: 'new@example.com', smsCode: '123456' });

      expect(smsService.verifyCode).toHaveBeenCalledWith(PHONE, '123456', SmsCodeType.VERIFY_IDENTITY);
      expect(mailService.confirmNewEmail).toHaveBeenCalled();
    });

    it('should check the email is available before consuming the SMS code', async () => {
      await useUser({ password: undefined, phone: PHONE });
      usersService.findByEmail.mockResolvedValue({ id: 2 } as User);

      const error = await service
        .update(payload, { email: 'new@example.com', smsCode: '123456' })
        .catch((e: unknown) => e);

      expect(rejectionErrors(error)).toEqual({ email: 'emailExists' });
      expect(smsService.verifyCode).not.toHaveBeenCalled();
    });

    it('should reject changing the email of a user without a password or phone', async () => {
      await useUser({ password: undefined, phone: null });

      const error = await service.update(payload, { email: 'new@example.com' }).catch((e: unknown) => e);

      expect(rejectionErrors(error)).toEqual({ phone: 'phoneRequiredForVerification' });
      expect(mailService.confirmNewEmail).not.toHaveBeenCalled();
    });

    it('should reject deleting the account of a user without a password or phone', async () => {
      await useUser({ password: undefined, phone: null });

      const error = await service.softDelete({ id: 1 }, {}).catch((e: unknown) => e);

      expect(rejectionErrors(error)).toEqual({ phone: 'phoneRequiredForVerification' });
      expect(usersService.remove).not.toHaveBeenCalled();
    });

    it('should reject an invalid SMS code when deleting the account', async () => {
      await useUser({ password: undefined, phone: PHONE });
      smsService.verifyCode.mockResolvedValue({ success: false, message: 'invalid' });

      const error = await service.softDelete({ id: 1 }, { smsCode: '000000' }).catch((e: unknown) => e);

      expect(rejectionErrors(error)).toEqual({ code: 'invalidCode' });
      expect(usersService.remove).not.toHaveBeenCalled();
    });

    it('should require the current password to delete the account of a user with a password', async () => {
      await useUser({ password: await hashPassword(OLD_PASSWORD) });

      const error = await service.softDelete({ id: 1 }, {}).catch((e: unknown) => e);

      expect(rejectionErrors(error)).toEqual({ oldPassword: 'missingOldPassword' });
      expect(usersService.remove).not.toHaveBeenCalled();
    });

    it('should delete the account after the current password is verified', async () => {
      await useUser({ password: await hashPassword(OLD_PASSWORD) });

      await service.softDelete({ id: 1 }, { oldPassword: OLD_PASSWORD });

      expect(usersService.remove).toHaveBeenCalledWith(1);
    });
  });

  describe('password login', () => {
    const MD5 = 'e10adc3949ba59abbe56e057f20f883e';

    let usersService: Mocked<Pick<UsersService, 'findByEmail' | 'findByPhone'>>;
    let service: AuthService;

    async function wechatUserWithPassword(): Promise<User> {
      return {
        id: 1,
        email: 'a@example.com',
        phone: '13800000000',
        provider: AuthProvidersEnum.wechat,
        password: await hashPassword(MD5),
        role: { id: 2 },
        status: { id: StatusEnum.active },
      } as User;
    }

    beforeEach(async () => {
      usersService = { findByEmail: vi.fn(), findByPhone: vi.fn() };
      const sessionService = { create: vi.fn().mockResolvedValue({ id: 10 }) };
      const tokenService = {
        generateSessionHash: vi.fn().mockReturnValue('H'),
        getTokensData: vi.fn().mockResolvedValue({ token: 't', refreshToken: 'r', tokenExpires: 1 }),
      };

      const moduleRef = await Test.createTestingModule({ providers: [AuthService] })
        .useMocker((token) => {
          if (token === UsersService) return usersService;
          if (token === SessionService) return sessionService;
          if (token === TokenService) return tokenService;
          return {};
        })
        .compile();
      service = moduleRef.get(AuthService);
    });

    it('should log in with email and password regardless of the sign-up provider', async () => {
      usersService.findByEmail.mockResolvedValue(await wechatUserWithPassword());

      await expect(service.validateLogin({ email: 'a@example.com', password: MD5 })).resolves.toMatchObject({
        token: 't',
      });
    });

    it('should log in with phone and password regardless of the sign-up provider', async () => {
      usersService.findByPhone.mockResolvedValue(await wechatUserWithPassword());

      await expect(service.validatePhoneLogin({ phone: '13800000000', password: MD5 })).resolves.toMatchObject({
        token: 't',
      });
    });

    it('should reject a user without a password', async () => {
      usersService.findByPhone.mockResolvedValue({ ...(await wechatUserWithPassword()), password: undefined });

      await expect(service.validatePhoneLogin({ phone: '13800000000', password: MD5 })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });
  });

  describe('sessions', () => {
    let sessionService: Mocked<
      Pick<SessionService, 'create' | 'findActiveByUserId' | 'revokeForUser' | 'deleteByUserIdWithExclude'>
    >;
    let service: AuthService;
    const me = { id: 1, sessionId: 10, role: { id: 2 } } as JwtPayloadType;

    beforeEach(async () => {
      sessionService = {
        create: vi.fn().mockResolvedValue({ id: 10 }),
        findActiveByUserId: vi.fn(),
        revokeForUser: vi.fn(),
        deleteByUserIdWithExclude: vi.fn(),
      };
      const tokenService = {
        generateSessionHash: vi.fn().mockReturnValue('H'),
        getTokensData: vi.fn().mockResolvedValue({ token: 't', refreshToken: 'r', tokenExpires: 1 }),
      };
      const moduleRef = await Test.createTestingModule({ providers: [AuthService] })
        .useMocker((token) => {
          if (token === SessionService) return sessionService;
          if (token === TokenService) return tokenService;
          return {};
        })
        .compile();
      service = moduleRef.get(AuthService);
    });

    it('should list the sessions of the user and mark the current one', async () => {
      const createdAt = new Date('2026-11-01T00:00:00Z');
      sessionService.findActiveByUserId.mockResolvedValue([
        { id: 10, userAgent: 'UA-A', ip: '10.0.0.1', createdAt, lastActiveAt: createdAt },
        { id: 11, createdAt },
      ] as never);

      await expect(service.listSessions(me)).resolves.toEqual([
        { id: 10, userAgent: 'UA-A', ip: '10.0.0.1', createdAt, lastActiveAt: createdAt, current: true },
        { id: 11, userAgent: null, ip: null, createdAt, lastActiveAt: null, current: false },
      ]);
      expect(sessionService.findActiveByUserId).toHaveBeenCalledWith(1);
    });

    it('should respond 404 when revoking a session that is not the user own', async () => {
      sessionService.revokeForUser.mockResolvedValue(false);

      await expect(service.revokeSession(me, 99)).rejects.toBeInstanceOf(NotFoundException);
      expect(sessionService.revokeForUser).toHaveBeenCalledWith(99, 1);
    });

    it('should revoke every other session of the user', async () => {
      await service.revokeOtherSessions(me);

      expect(sessionService.deleteByUserIdWithExclude).toHaveBeenCalledWith({ userId: 1, excludeSessionId: 10 });
    });

    it('should record the client user agent and ip on a new session', async () => {
      const req = {
        headers: {},
        ip: '203.0.113.7',
        get: (name: string) => (name === 'user-agent' ? 'UA/1.0' : undefined),
      } as unknown as Request;
      const user = { id: 1, role: { id: 2 } } as User;
      let login: Promise<unknown> = Promise.resolve();
      const next: NextFunction = () => {
        login = service['createSessionAndTokens'](user);
      };

      requestContextMiddleware(req, { setHeader: vi.fn() } as unknown as Response, next);
      await login;

      expect(sessionService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user,
          hash: 'H',
          userAgent: 'UA/1.0',
          ip: '203.0.113.7',
          lastActiveAt: expect.any(Date),
        }),
      );
    });
  });
});
