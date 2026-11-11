import { ApiProperty } from '@nestjs/swagger';

export class SessionResponseDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ type: String, nullable: true, example: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
  userAgent: string | null;

  @ApiProperty({ type: String, nullable: true, example: '203.0.113.7' })
  ip: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  lastActiveAt: Date | null;

  @ApiProperty({ description: '是否为发起本次请求的会话' })
  current: boolean;
}
