import { ApiProperty } from '@nestjs/swagger';
import { GameRefreshResponseDto } from './game-refresh-response.dto';

export class GameLoginResponseDto extends GameRefreshResponseDto {
  @ApiProperty({ example: '1' })
  userId: string;

  @ApiProperty({ description: '服务器当前时间（毫秒时间戳）' })
  serverTime: number;
}
