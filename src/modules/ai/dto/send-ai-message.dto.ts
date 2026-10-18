import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export const AI_MESSAGE_MAX_LENGTH = 500;

export class SendAiMessageDto {
  @ApiProperty({ type: String, maxLength: AI_MESSAGE_MAX_LENGTH })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_MESSAGE_MAX_LENGTH)
  content: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    description: '在练习会话内提问时携带，题目须属于该会话并按该会话判定答案可见性；不带时按会话外规则判定',
  })
  @IsOptional()
  @IsUUID()
  sessionId?: string;
}
