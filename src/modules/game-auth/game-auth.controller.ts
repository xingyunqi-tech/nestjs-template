import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipResponseTransform } from '../../common/decorators/skip-response-transform.decorator';
import { GameAuthService } from './game-auth.service';
import { GameLoginDto } from './dto/game-login.dto';
import { GameRefreshDto } from './dto/game-refresh.dto';
import { GameLoginResponseDto } from './dto/game-login-response.dto';
import { GameRefreshResponseDto } from './dto/game-refresh-response.dto';

/** 手机网络常见多个玩家共用出口 IP，按 IP 限流放宽到每分钟 60 次 */
const GAME_AUTH_THROTTLE = { default: { limit: 60, ttl: 60000 } };

/** 小游戏客户端直接读取响应体，不包装统一响应格式 */
@ApiTags('Game Auth')
@SkipResponseTransform()
@Controller({ path: 'game/auth', version: '1' })
export class GameAuthController {
  constructor(private readonly gameAuthService: GameAuthService) {}

  @ApiOperation({ operationId: 'gameLogin', summary: '小游戏登录' })
  @ApiOkResponse({ type: GameLoginResponseDto })
  @Post('login')
  @Throttle(GAME_AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: GameLoginDto): Promise<GameLoginResponseDto> {
    return this.gameAuthService.login(dto);
  }

  @ApiOperation({ operationId: 'gameRefreshToken', summary: '小游戏刷新令牌' })
  @ApiOkResponse({ type: GameRefreshResponseDto })
  @Post('refresh')
  @Throttle(GAME_AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  refresh(@Body() dto: GameRefreshDto): Promise<GameRefreshResponseDto> {
    return this.gameAuthService.refresh(dto);
  }
}
