import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { QuestionType } from '../domain/question-type';
import { QuestionSource } from '../domain/question-source';
import { QuestionAnswer } from '../domain/question-answer';
import { QuestionOptionDto } from './question-option.dto';

const toLowerCase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.toLowerCase() : value;
const toLowerCaseEach = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) ? value.map((item: unknown) => (typeof item === 'string' ? item.toLowerCase() : item)) : value;

export class CreateQuestionDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @Transform(toLowerCase)
  @IsUUID()
  subjectId: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', description: '新建材料题小题时传所属材料，材料须为草稿' })
  @IsOptional()
  @Transform(toLowerCase)
  @IsUUID()
  parentId?: string;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType' })
  @IsEnum(QuestionType)
  type: QuestionType;

  @ApiProperty({ type: String, description: 'Markdown + LaTeX，图片以 file:{fileId} 引用' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  stem: string;

  @ApiPropertyOptional({ type: [QuestionOptionDto], nullable: true, description: '单选、多选必填' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(26)
  @ValidateNested({ each: true })
  @Type(() => QuestionOptionDto)
  options?: QuestionOptionDto[] | null;

  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    description: '结构随题型变化，材料题为空',
    example: { keys: ['B'] },
  })
  @IsOptional()
  @IsObject()
  answer?: QuestionAnswer | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20000)
  analysis?: string | null;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 5, default: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  difficulty?: number;

  @ApiPropertyOptional({ type: String, format: 'uuid', isArray: true, description: '叶子知识点，材料不可关联' })
  @IsOptional()
  @Transform(toLowerCaseEach)
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  knowledgePointIds?: string[];

  @ApiPropertyOptional({ type: String, nullable: true, description: '仅材料题' })
  @IsOptional()
  @IsString()
  @MaxLength(50000)
  material?: string | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true, description: '仅材料题，听力音频文件' })
  @IsOptional()
  @Transform(toLowerCase)
  @IsUUID()
  audioFileId?: string | null;

  @ApiPropertyOptional({ enum: QuestionSource, enumName: 'QuestionSource', default: QuestionSource.ORIGINAL })
  @IsOptional()
  @IsEnum(QuestionSource)
  source?: QuestionSource;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2025 年模拟卷' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sourceNote?: string | null;

  @ApiPropertyOptional({ type: Boolean, default: true, description: '小题跟随材料，传入忽略' })
  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @ApiPropertyOptional({ type: Number, description: '小题顺序，默认排在最后' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;
}
