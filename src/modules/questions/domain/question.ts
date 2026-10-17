import { ApiProperty } from '@nestjs/swagger';
import { QuestionType } from './question-type';
import { QuestionStatus } from './question-status';
import { QuestionSource } from './question-source';
import { QuestionAnswer, QuestionOption } from './question-answer';

export class Question {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid' })
  subjectId: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: '材料题小题所属材料' })
  parentId: string | null;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType' })
  type: QuestionType;

  @ApiProperty({ type: Number, description: '当前生效版本号，未发布过为 0' })
  currentVersion: number;

  @ApiProperty({ type: String, description: 'Markdown + LaTeX，文件以 file:{id} 引用' })
  stem: string;

  @ApiProperty({ type: Object, isArray: true, nullable: true, example: [{ key: 'A', content: '选项内容' }] })
  options: QuestionOption[] | null;

  @ApiProperty({ type: Object, nullable: true, example: { keys: ['B'] } })
  answer: QuestionAnswer | null;

  @ApiProperty({ type: String, nullable: true })
  analysis: string | null;

  @ApiProperty({ type: Number, minimum: 1, maximum: 5 })
  difficulty: number;

  @ApiProperty({ type: String, format: 'uuid', isArray: true, description: '叶子知识点' })
  knowledgePointIds: string[];

  @ApiProperty({ type: String, nullable: true })
  material: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  audioFileId: string | null;

  @ApiProperty({ enum: QuestionSource, enumName: 'QuestionSource' })
  source: QuestionSource;

  @ApiProperty({ type: String, nullable: true })
  sourceNote: string | null;

  @ApiProperty({ enum: QuestionStatus, enumName: 'QuestionStatus' })
  status: QuestionStatus;

  @ApiProperty({ type: Boolean, description: '小题跟随材料' })
  isFree: boolean;

  @ApiProperty({ type: Number, description: '小题在材料内的顺序' })
  sort: number;

  @ApiProperty({ type: String })
  contentHash: string;

  @ApiProperty({ type: Number })
  statAnswered: number;

  @ApiProperty({ type: Number })
  statCorrect: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export type QuestionSummary = Pick<Question, 'id' | 'parentId' | 'type' | 'stem'>;
