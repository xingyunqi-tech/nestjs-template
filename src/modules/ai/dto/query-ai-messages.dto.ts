import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

export class QueryAiMessagesDto {
  @ApiPropertyOptional({ type: String, format: 'uuid', description: '返回该消息之前的消息，缺省为最新' })
  @IsOptional()
  @IsUUID()
  beforeId?: string;

  @ApiPropertyOptional({ type: Number, default: 20, maximum: 50 })
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 20))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

export class QueryAiMessageEventsDto {
  @ApiPropertyOptional({
    type: String,
    default: '0',
    description: '从该事件 id（SSE 的 id 字段或消息的 lastEventId）之后续读，缺省从头读取',
  })
  @IsOptional()
  @Matches(/^\d+(-\d+)?$/)
  after?: string;
}
