import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { AiMessageFeedback } from '../domain/ai-message';

export const AI_REPORT_MAX_LENGTH = 500;

export class SetAiMessageFeedbackDto {
  @ApiProperty({ enum: AiMessageFeedback, enumName: 'AiMessageFeedback', nullable: true, description: 'null 为撤销' })
  @ValidateIf((dto: SetAiMessageFeedbackDto) => dto.feedback !== null)
  @IsEnum(AiMessageFeedback)
  feedback: AiMessageFeedback | null;
}

export class ReportAiMessageDto {
  @ApiPropertyOptional({ type: String, maxLength: AI_REPORT_MAX_LENGTH, description: '举报说明' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value))
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(AI_REPORT_MAX_LENGTH)
  content?: string;
}
