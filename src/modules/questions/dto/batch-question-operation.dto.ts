import { ApiProperty, ApiPropertyOptional, IntersectionType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { QuestionSource } from '../domain/question-source';
import { QUESTION_KNOWLEDGE_POINTS_MAX } from '../domain/question';
import { RejectQuestionDto } from './reject-question.dto';

export const BATCH_QUESTION_IDS_MAX = 100;

export enum KnowledgePointUpdateMode {
  APPEND = 'append',
  REPLACE = 'replace',
}

const toLowerCaseEach = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) ? value.map((item: unknown) => (typeof item === 'string' ? item.toLowerCase() : item)) : value;

export class BatchQuestionIdsDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    isArray: true,
    minItems: 1,
    maxItems: BATCH_QUESTION_IDS_MAX,
    uniqueItems: true,
    description: '题目 id，不可重复',
  })
  @Transform(toLowerCaseEach)
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(BATCH_QUESTION_IDS_MAX)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids: string[];
}

export class BatchRejectQuestionsDto extends IntersectionType(BatchQuestionIdsDto, RejectQuestionDto) {}

export class BatchUpdateQuestionsDto extends BatchQuestionIdsDto {
  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    isArray: true,
    maxItems: QUESTION_KNOWLEDGE_POINTS_MAX,
    uniqueItems: true,
    description: '叶子知识点，须同时传 mode；材料不可关联',
  })
  @ValidateIf((dto: BatchUpdateQuestionsDto) => dto.knowledgePointIds !== undefined)
  @Transform(toLowerCaseEach)
  @IsArray()
  @ArrayMaxSize(QUESTION_KNOWLEDGE_POINTS_MAX)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  knowledgePointIds?: string[];

  @ApiPropertyOptional({
    enum: KnowledgePointUpdateMode,
    enumName: 'KnowledgePointUpdateMode',
    description: '传 knowledgePointIds 时必填：append 追加到现有知识点，replace 整体替换',
  })
  @ValidateIf((dto: BatchUpdateQuestionsDto) => dto.knowledgePointIds !== undefined)
  @IsEnum(KnowledgePointUpdateMode)
  mode?: KnowledgePointUpdateMode;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiPropertyOptional({ enum: QuestionSource, enumName: 'QuestionSource' })
  @IsOptional()
  @IsEnum(QuestionSource)
  source?: QuestionSource;

  @ApiPropertyOptional({ type: Boolean, description: '小题跟随所属材料，对小题不生效' })
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;
}

export class BatchQuestionFailureDto {
  @ApiProperty({ type: String, format: 'uuid', description: '请求中的题目 id' })
  id: string;

  @ApiProperty({ type: String, example: 'selfReviewForbidden', description: '错误码（i18n key）' })
  error: string;

  @ApiProperty({ type: String, example: '不能审核自己提交的题目', description: '按请求语言翻译的错误信息' })
  message: string;
}

export class BatchQuestionsResultDto {
  @ApiProperty({ type: Number, description: '成功的请求 id 数' })
  succeeded: number;

  @ApiProperty({ type: [BatchQuestionFailureDto], description: '失败的请求 id，按请求顺序' })
  failed: BatchQuestionFailureDto[];
}
