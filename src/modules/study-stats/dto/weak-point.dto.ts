import { ApiProperty } from '@nestjs/swagger';

export class WeakPointDto {
  @ApiProperty({ type: String, format: 'uuid' })
  knowledgePointId: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: String, description: '物化路径' })
  path: string;

  @ApiProperty({ type: Number })
  answered: number;

  @ApiProperty({ type: Number })
  correct: number;

  @ApiProperty({ type: Number, description: '掌握度（百分制，两位小数）' })
  mastery: number;
}
