import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PracticeMode } from '../domain/practice-mode';
import { QuestionType } from '../../questions/domain/question-type';

export const PRACTICE_SESSION_LIMITS = {
  defaultCount: 10,
  maxCount: 100,
  deviceIdLength: 64,
} as const;

const lowercase = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.toLowerCase() : value);

export class PracticeScopeDto {
  @ApiPropertyOptional({ type: String, format: 'uuid', description: '章节练习必填；背题模式可选' })
  @IsOptional()
  @Transform(lowercase)
  @IsUUID()
  knowledgePointId?: string;

  @ApiPropertyOptional({ enum: QuestionType, enumName: 'QuestionType', description: '题型专项必填；背题模式可选' })
  @IsOptional()
  @IsEnum(QuestionType)
  questionType?: QuestionType;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: '错题重做：指定会话中的错题' })
  @IsOptional()
  @Transform(lowercase)
  @IsUUID()
  fromSessionId?: string;
}

export class CreatePracticeSessionDto {
  @ApiProperty({ enum: PracticeMode, enumName: 'PracticeMode' })
  @IsEnum(PracticeMode)
  mode: PracticeMode;

  @ApiProperty({ type: String, format: 'uuid' })
  @Transform(lowercase)
  @IsUUID()
  subjectId: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: '仅模拟考试' })
  @IsOptional()
  @Transform(lowercase)
  @IsUUID()
  paperId?: string;

  @ApiPropertyOptional({ type: PracticeScopeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PracticeScopeDto)
  scope?: PracticeScopeDto;

  @ApiPropertyOptional({
    type: Number,
    default: PRACTICE_SESSION_LIMITS.defaultCount,
    maximum: PRACTICE_SESSION_LIMITS.maxCount,
    description: '题量，以小题计；每日一练与指定会话的错题重做忽略',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PRACTICE_SESSION_LIMITS.maxCount)
  count?: number;

  @ApiProperty({ type: String, maxLength: PRACTICE_SESSION_LIMITS.deviceIdLength })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRACTICE_SESSION_LIMITS.deviceIdLength)
  deviceId: string;
}
