import { ApiProperty } from '@nestjs/swagger';

export class AiQuotaItemDto {
  @ApiProperty({ type: Number })
  limit: number;

  @ApiProperty({ type: Number })
  used: number;

  @ApiProperty({ type: Number })
  remaining: number;
}

export class AiQuotaDto {
  @ApiProperty({ type: String, format: 'date', description: '额度所属日期（Asia/Shanghai）' })
  date: string;

  @ApiProperty({ type: () => AiQuotaItemDto, description: '讲题与对话' })
  chat: AiQuotaItemDto;
}
