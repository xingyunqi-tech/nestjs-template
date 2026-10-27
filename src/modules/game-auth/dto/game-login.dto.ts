import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { GamePlatform } from '../domain/game-player';

export class GameLoginDto {
  @ApiProperty({ enum: GamePlatform, example: GamePlatform.WECHAT })
  @IsEnum(GamePlatform)
  platform: GamePlatform;

  @ApiProperty({ example: '0a3Xxx', description: 'wx.login 返回的 code' })
  @IsNotEmpty()
  @IsString()
  code: string;
}
