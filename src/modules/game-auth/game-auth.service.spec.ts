import type { Mocked } from 'vitest';
import { UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AllConfigType } from '../../config/config.type';
import { WechatService } from '../../integrations/wechat/wechat.service';
import { GameAuthService } from './game-auth.service';
import { GamePlayerRepository } from './infrastructure/persistence/game-player.repository';
import { GamePlatform, GamePlayer } from './domain/game-player';

describe('GameAuthService', () => {
  let repository: Mocked<GamePlayerRepository>;
  let wechatService: { miniGameLogin: ReturnType<typeof vi.fn> };
  let config: Record<string, unknown>;
  let jwtService: JwtService;
  let service: GameAuthService;

  const player = (refreshHash: string): GamePlayer =>
    Object.assign(new GamePlayer(), {
      id: 7,
      platform: GamePlatform.WECHAT,
      openId: 'openid',
      unionId: null,
      refreshHash,
      lastLoginAt: new Date(),
      createdAt: new Date(),
    });

  beforeEach(() => {
    repository = {
      upsertLogin: vi.fn((data: { refreshHash: string }) => Promise.resolve(player(data.refreshHash))),
      findById: vi.fn().mockResolvedValue(null),
      rotateRefreshHash: vi.fn().mockResolvedValue(true),
    };
    wechatService = { miniGameLogin: vi.fn().mockResolvedValue({ openId: 'openid', unionId: 'union' }) };
    config = {
      'gameAuth.secret': 'game-secret',
      'gameAuth.refreshSecret': 'game-refresh-secret',
      'gameAuth.expires': '2h',
      'gameAuth.refreshExpires': '365d',
    };
    const configService = { get: vi.fn((key: string) => config[key]), getOrThrow: vi.fn((key: string) => config[key]) };
    jwtService = new JwtService({});
    service = new GameAuthService(
      repository,
      wechatService as unknown as WechatService,
      jwtService,
      configService as unknown as ConfigService<AllConfigType>,
    );
  });

  describe('login', () => {
    it('should create or update the player and return tokens in the game client format', async () => {
      const result = await service.login({ platform: GamePlatform.WECHAT, code: 'code' });

      expect(wechatService.miniGameLogin).toHaveBeenCalledWith('code');
      expect(repository.upsertLogin).toHaveBeenCalledWith(
        expect.objectContaining({ platform: GamePlatform.WECHAT, openId: 'openid', unionId: 'union' }),
      );
      expect(result).toEqual({
        token: expect.any(String),
        refreshToken: expect.any(String),
        expiresIn: 7200,
        userId: '7',
        serverTime: expect.any(Number),
      });
      await expect(jwtService.verifyAsync(result.token, { secret: 'game-secret' })).resolves.toMatchObject({ id: 7 });
    });

    it('should reject before calling WeChat when the secrets are missing', async () => {
      config['gameAuth.refreshSecret'] = undefined;

      await expect(service.login({ platform: GamePlatform.WECHAT, code: 'code' })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(wechatService.miniGameLogin).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    async function loggedIn() {
      const result = await service.login({ platform: GamePlatform.WECHAT, code: 'code' });
      const { refreshHash } = repository.upsertLogin.mock.calls[0][0];
      repository.findById.mockResolvedValue(player(refreshHash));
      return { refreshToken: result.refreshToken, refreshHash };
    }

    it('should rotate the refresh hash and issue new tokens', async () => {
      const { refreshToken, refreshHash } = await loggedIn();

      const result = await service.refresh({ refreshToken });

      expect(repository.rotateRefreshHash).toHaveBeenCalledWith(7, refreshHash, expect.any(String));
      expect(repository.rotateRefreshHash.mock.calls[0][2]).not.toBe(refreshHash);
      expect(result).toEqual({ token: expect.any(String), refreshToken: expect.any(String), expiresIn: 7200 });
    });

    it('should reject a refresh token whose hash is no longer current', async () => {
      const { refreshToken } = await loggedIn();
      repository.findById.mockResolvedValue(player('newer-hash'));

      await expect(service.refresh({ refreshToken })).rejects.toBeInstanceOf(UnauthorizedException);
      expect(repository.rotateRefreshHash).not.toHaveBeenCalled();
    });

    it('should reject a token signed with another secret', async () => {
      const refreshToken = await jwtService.signAsync({ id: 7, hash: 'hash' }, { secret: 'user-refresh-secret' });

      await expect(service.refresh({ refreshToken })).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('should reject when the hash was rotated concurrently', async () => {
      const { refreshToken } = await loggedIn();
      repository.rotateRefreshHash.mockResolvedValue(false);

      await expect(service.refresh({ refreshToken })).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
