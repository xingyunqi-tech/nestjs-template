import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContentStatus } from '../../exams/domain/content-status';
import { QuestionType } from '../../questions/domain/question-type';
import { MultiScoringRule } from './multi-scoring-rule';

export class PaperRuleItem {
  @ApiProperty({ type: String })
  sectionTitle: string;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType', description: 'MATERIAL 时以材料为单位抽题' })
  questionType: QuestionType;

  @ApiPropertyOptional({ type: String, format: 'uuid', isArray: true, description: '含下级知识点' })
  knowledgePointIds?: string[];

  @ApiPropertyOptional({ type: Number, isArray: true, minItems: 2, maxItems: 2, example: [1, 5] })
  difficultyRange?: [number, number];

  @ApiProperty({ type: Number, description: '可作答题数' })
  count: number;

  @ApiProperty({ type: Number })
  scorePerQuestion: number;
}

export class PaperRule {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid' })
  subjectId: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: Number })
  durationMin: number;

  @ApiProperty({ enum: MultiScoringRule, enumName: 'MultiScoringRule' })
  multiScoringRule: MultiScoringRule;

  @ApiProperty({ type: [PaperRuleItem] })
  items: PaperRuleItem[];

  @ApiProperty({ enum: ContentStatus, enumName: 'ContentStatus' })
  status: ContentStatus;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
