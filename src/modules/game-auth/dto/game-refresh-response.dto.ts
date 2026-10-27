import { ApiProperty } from '@nestjs/swagger';

export class GameRefreshResponseDto {
  @ApiProperty()
  token: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty({ description: '访问令牌有效期（秒）' })
  expiresIn: number;
}
