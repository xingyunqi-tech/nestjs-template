import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IMPORT_SHEETS } from '../package/sheet-row';

export class ImportEntityCountsDto {
  @ApiProperty({ type: Number, description: '知识点行数（一行为一个路径）' })
  knowledgePoints: number;

  @ApiProperty({ type: Number, description: '材料数，材料连同其小题计为一个' })
  materials: number;

  @ApiProperty({ type: Number, description: '独立题数，不含材料小题' })
  questions: number;

  @ApiProperty({ type: Number })
  papers: number;
}

export class ImportRowErrorDto {
  @ApiProperty({ type: String, enum: IMPORT_SHEETS, example: 'questions' })
  sheet: string;

  @ApiProperty({ type: Number, description: 'xlsx 为表格行号（表头为第 1 行），JSON 为数组下标加 1' })
  row: number;

  @ApiProperty({ type: String, example: 'answer' })
  field: string;

  @ApiProperty({ type: String, description: '错误键', example: 'invalidQuestionAnswer' })
  reason: string;

  @ApiProperty({ type: String, description: '错误说明，与错误行报告 xlsx 的 message 列相同' })
  message: string;

  @ApiPropertyOptional({ type: String })
  detail?: string;
}

export class ImportPrecheckResultDto {
  @ApiProperty({ type: ImportEntityCountsDto, description: '导入后将新建的内容' })
  wouldCreate: ImportEntityCountsDto;

  @ApiProperty({ type: ImportEntityCountsDto, description: '按 id 更新的内容' })
  wouldUpdate: ImportEntityCountsDto;

  @ApiProperty({ type: ImportEntityCountsDto, description: '内容已存在、导入时跳过的内容' })
  wouldSkip: ImportEntityCountsDto;

  @ApiProperty({ type: [ImportRowErrorDto], description: '错误行，最多 500 条' })
  errors: ImportRowErrorDto[];

  @ApiProperty({ type: Boolean, description: '错误行超过 500 条时为 true，其余未返回' })
  truncated: boolean;
}
