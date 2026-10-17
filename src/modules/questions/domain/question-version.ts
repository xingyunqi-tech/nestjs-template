import { ApiProperty } from '@nestjs/swagger';
import { QuestionType } from './question-type';
import { QuestionAnswer, QuestionOption } from './question-answer';

export enum QuestionChangeType {
  PUBLISH = 'PUBLISH',
  EDIT = 'EDIT',
  ERRATA = 'ERRATA',
}

export class QuestionVersion {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid' })
  questionId: string;

  @ApiProperty({ type: Number, example: 1 })
  version: number;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType' })
  type: QuestionType;

  @ApiProperty({ type: String })
  stem: string;

  @ApiProperty({ type: Object, isArray: true, nullable: true, example: [{ key: 'A', content: '选项内容' }] })
  options: QuestionOption[] | null;

  @ApiProperty({ type: Object, nullable: true })
  answer: QuestionAnswer | null;

  @ApiProperty({ type: String, nullable: true })
  analysis: string | null;

  @ApiProperty({ type: String, nullable: true })
  material: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  audioFileId: string | null;

  @ApiProperty({ type: String, format: 'uuid', isArray: true })
  knowledgePointIds: string[];

  @ApiProperty({ type: Number, nullable: true, description: '小题对应的材料版本，材料与独立题为空' })
  materialVersion: number | null;

  @ApiProperty({ enum: QuestionChangeType, enumName: 'QuestionChangeType' })
  changeType: QuestionChangeType;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
