import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Question } from '../domain/question';
import { QuestionVersion } from '../domain/question-version';
import { QuestionType } from '../domain/question-type';
import { FillAnswer, QuestionOption } from '../domain/question-answer';

/** 用户与公开接口的题目内容，不含答案与解析 */
export class PublicQuestionDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid' })
  subjectId: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  parentId: string | null;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType' })
  type: QuestionType;

  @ApiProperty({ type: Number })
  version: number;

  @ApiProperty({ type: String })
  stem: string;

  @ApiProperty({ type: Object, isArray: true, nullable: true, example: [{ key: 'A', content: '选项内容' }] })
  options: QuestionOption[] | null;

  @ApiProperty({ type: String, nullable: true })
  material: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  audioFileId: string | null;

  @ApiProperty({ type: String, nullable: true, description: '材料音频的访问地址，文件不可访问时为 null' })
  audioUrl: string | null;

  @ApiProperty({ type: Number, nullable: true, description: '填空题的空数，其他题型为 null' })
  blankCount: number | null;

  @ApiProperty({ type: Number, minimum: 1, maximum: 5 })
  difficulty: number;

  @ApiProperty({ type: String, format: 'uuid', isArray: true })
  knowledgePointIds: string[];

  @ApiProperty({ type: Boolean })
  isFree: boolean;

  @ApiProperty({ type: Number })
  sort: number;
}

export class PublicQuestionUnitDto extends PublicQuestionDto {
  @ApiPropertyOptional({ type: () => [PublicQuestionDto], description: '材料题的小题，按顺序' })
  children?: PublicQuestionDto[];
}

/** 传入版本时题面取自该版本快照，知识点始终取当前关联；fileUrls 键为小写文件 id */
export function toPublicQuestion(
  question: Question,
  version?: QuestionVersion,
  fileUrls: Record<string, string> = {},
): PublicQuestionDto {
  const content = version ?? question;
  const dto = new PublicQuestionDto();
  dto.id = question.id;
  dto.subjectId = question.subjectId;
  dto.parentId = question.parentId;
  dto.type = content.type;
  dto.version = version?.version ?? question.currentVersion;
  dto.stem = content.stem;
  dto.options = content.options
    ? content.options.map((option) => ({ key: option.key, content: option.content }))
    : null;
  dto.material = content.material;
  dto.audioFileId = content.audioFileId;
  dto.audioUrl = content.audioFileId ? (fileUrls[content.audioFileId.toLowerCase()] ?? null) : null;
  dto.blankCount =
    content.type === QuestionType.FILL ? ((content.answer as FillAnswer | null)?.blanks.length ?? null) : null;
  dto.difficulty = question.difficulty;
  dto.knowledgePointIds = [...question.knowledgePointIds];
  dto.isFree = question.isFree;
  dto.sort = question.sort;
  return dto;
}
