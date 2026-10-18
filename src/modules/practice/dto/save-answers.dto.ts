import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
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
import { SelfAssessment } from '../domain/answer-record';
import { HiddenReason } from '../domain/hidden-reason';
import { QuestionSolutionDto } from '../../questions/dto/question-solution.dto';
import { AnswerStateDto } from './answer-state.dto';
import { PRACTICE_SESSION_LIMITS } from './create-practice-session.dto';

export const SAVE_ANSWERS_LIMITS = { maxItems: 200, maxDurationSec: 86_400, maxClientSeq: 2_147_483_647 } as const;

const lowercase = ({ value }: { value: unknown }): unknown => (typeof value === 'string' ? value.toLowerCase() : value);

export class AnswerPatchDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @Transform(lowercase)
  @IsUUID()
  questionId: string;

  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    example: { keys: ['B'] },
    description: '省略时只更新标记；为空视为未作答，模拟考试中为清空已有答案',
  })
  @IsOptional()
  answer?: unknown;

  @ApiPropertyOptional({ type: Boolean })
  @IsOptional()
  @IsBoolean()
  markedForReview?: boolean;

  @ApiPropertyOptional({ type: Number, description: '单题用时（秒），超过 600 按 600 记' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(SAVE_ANSWERS_LIMITS.maxDurationSec)
  durationSec?: number;

  @ApiProperty({ type: Number, description: '设备内递增序号' })
  @IsInt()
  @Min(0)
  @Max(SAVE_ANSWERS_LIMITS.maxClientSeq)
  clientSeq: number;

  @ApiProperty({ type: Date, description: '客户端作答时间（按 serverNow 校准）' })
  @Type(() => Date)
  @IsDate()
  clientAnsweredAt: Date;
}

export class SaveAnswersDto {
  @ApiProperty({ type: String, maxLength: PRACTICE_SESSION_LIMITS.deviceIdLength })
  @IsString()
  @IsNotEmpty()
  @MaxLength(PRACTICE_SESSION_LIMITS.deviceIdLength)
  deviceId: string;

  @ApiPropertyOptional({ type: Boolean, description: '离线补交（模拟考试）' })
  @IsOptional()
  @IsBoolean()
  offline?: boolean;

  @ApiProperty({ type: [AnswerPatchDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SAVE_ANSWERS_LIMITS.maxItems)
  @ValidateNested({ each: true })
  @Type(() => AnswerPatchDto)
  answers: AnswerPatchDto[];
}

export class AnswerResultDto {
  @ApiProperty({ type: String, format: 'uuid' })
  questionId: string;

  @ApiProperty({ type: AnswerStateDto, nullable: true })
  answerState: AnswerStateDto | null;

  @ApiProperty({ type: QuestionSolutionDto, nullable: true })
  solution: QuestionSolutionDto | null;

  @ApiProperty({ enum: HiddenReason, enumName: 'HiddenReason', nullable: true })
  hiddenReason: HiddenReason | null;
}

export class SaveAnswersResultDto {
  @ApiProperty()
  serverNow: Date;

  @ApiProperty({ type: [AnswerResultDto], description: '按提交顺序' })
  results: AnswerResultDto[];

  @ApiProperty({
    type: String,
    format: 'uuid',
    isArray: true,
    description: '模考离线补交中作答时间晚于截止时间而未写入的题目，其余照常写入',
  })
  skippedQuestionIds: string[];
}

export class SelfAssessmentDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @Transform(lowercase)
  @IsUUID()
  questionId: string;

  @ApiProperty({ enum: SelfAssessment, enumName: 'SelfAssessment' })
  @IsEnum(SelfAssessment)
  selfAssessment: SelfAssessment;
}
