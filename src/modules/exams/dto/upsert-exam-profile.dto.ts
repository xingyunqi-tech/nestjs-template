import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, Matches, Max, Min, ValidateIf } from 'class-validator';

export class UpsertExamProfileDto {
  @ApiPropertyOptional({ type: String, format: 'date', nullable: true, example: '2026-11-29' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  examDate?: string | null;

  @ApiPropertyOptional({ type: Number, default: 30, minimum: 1, maximum: 500 })
  @ValidateIf((_, value) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(500)
  dailyGoal?: number;
}
