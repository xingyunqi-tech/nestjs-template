import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { FeedbackStatus } from '../domain/feedback';

export class UpdateQuestionReportDto {
  @ApiPropertyOptional({ enum: FeedbackStatus })
  @IsOptional()
  @IsEnum(FeedbackStatus)
  status?: FeedbackStatus;

  @ApiPropertyOptional({ type: String, maxLength: 1000, description: '回复，用户在我的纠错中可见' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reply?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: '关联同一题的勘误任务，传 null 取消关联；关联已完成的勘误时纠错单置为已解决',
  })
  @IsOptional()
  @ValidateIf((dto: UpdateQuestionReportDto) => dto.errataId !== null)
  @IsUUID()
  errataId?: string | null;
}
