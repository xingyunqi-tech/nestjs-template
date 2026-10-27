import { HttpStatus, Injectable, Logger, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import ms from 'ms';
import { AllConfigType } from '../../config/config.type';
import { WechatService } from '../../integrations/wechat/wechat.service';
import { GamePlayerRepository } from './infrastructure/persistence/game-player.repository';
import { GamePlayer } from './domain/game-player';
import { GameLoginDto } from './dto/game-login.dto';
import { GameRefreshDto } from './dto/game-refresh.dto';
import { GameLoginResponseDto } from './dto/game-login-response.dto';
import { GameRefreshResponseDto } from './dto/game-refresh-response.dto';

interface GameRefreshPayload {
  id: number;
  hash: string;
}

@Injectable()
export class GameAuthService {
  private readonly logger = new Logger(GameAuthService.name);

  constructor(
    private readonly gamePlayerRepository: GamePlayerRepository,
    private readonly wechatService: WechatService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async login(dto: GameLoginDto): Promise<GameLoginResponseDto> {
    const secrets = this.secrets();
    const wechatUser = await this.wechatService.miniGameLogin(dto.code);
    const hash = randomBytes(32).toString('hex');
    const player = await this.gamePlayerRepository.upsertLogin({
      platform: dto.platform,
      openId: wechatUser.openId,
      unionId: wechatUser.unionId ?? null,
      refreshHash: hash,
    });
    this.logger.log(`Game player logged in: ${player.id}`);
    return {
      ...(await this.issueTokens(player.id, hash, secrets)),
      userId: String(player.id),
      serverTime: Date.now(),
    };
  }

  async refresh(dto: GameRefreshDto): Promise<GameRefreshResponseDto> {
    const secrets = this.secrets();
    let payload: GameRefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<GameRefreshPayload>(dto.refreshToken, {
        secret: secrets.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException();
    }

    const player = await this.gamePlayerRepository.findById(payload.id);
    if (player?.refreshHash !== payload.hash) {
      this.logger.warn(`Game token refresh rejected for player: ${payload.id}`);
      throw new UnauthorizedException();
    }

    const hash = randomBytes(32).toString('hex');
    if (!(await this.gamePlayerRepository.rotateRefreshHash(player.id, payload.hash, hash))) {
      throw new UnauthorizedException();
    }
    return this.issueTokens(player.id, hash, secrets);
  }

  private secrets(): { secret: string; refreshSecret: string } {
    const secret = this.configService.get('gameAuth.secret', { infer: true });
    const refreshSecret = this.configService.get('gameAuth.refreshSecret', { infer: true });
    if (!secret || !refreshSecret) {
      this.logger.error('Game auth secrets not configured');
      throw new UnprocessableEntityException({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        errors: { gameAuth: 'notConfigured' },
      });
    }
    return { secret, refreshSecret };
  }

  private async issueTokens(
    id: GamePlayer['id'],
    hash: string,
    secrets: { secret: string; refreshSecret: string },
  ): Promise<GameRefreshResponseDto> {
    const expires = this.configService.getOrThrow('gameAuth.expires', { infer: true });
    const [token, refreshToken] = await Promise.all([
      this.jwtService.signAsync({ id }, { secret: secrets.secret, expiresIn: expires }),
      this.jwtService.signAsync(
        { id, hash },
        {
          secret: secrets.refreshSecret,
          expiresIn: this.configService.getOrThrow('gameAuth.refreshExpires', { infer: true }),
        },
      ),
    ]);
    return { token, refreshToken, expiresIn: Math.floor(ms(expires) / 1000) };
  }
}
