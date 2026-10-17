import { ApiProperty } from '@nestjs/swagger';
import { ContentStatus } from '../../exams/domain/content-status';
import { PaperType } from './paper-type';
import { MultiScoringRule } from './multi-scoring-rule';
import { PaperSection } from './paper-section';

export class Paper {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid' })
  subjectId: string;

  @ApiProperty({ type: String })
  title: string;

  @ApiProperty({ enum: PaperType, enumName: 'PaperType' })
  type: PaperType;

  @ApiProperty({ type: Number, nullable: true })
  year: number | null;

  @ApiProperty({ type: Number, nullable: true, description: '按规则生成的试卷所属用户' })
  ownerUserId: number | null;

  @ApiProperty({ type: Number })
  durationMin: number;

  @ApiProperty({ type: [PaperSection] })
  sections: PaperSection[];

  @ApiProperty({ type: Number })
  totalScore: number;

  @ApiProperty({ type: Number })
  objectiveScore: number;

  @ApiProperty({ enum: MultiScoringRule, enumName: 'MultiScoringRule' })
  multiScoringRule: MultiScoringRule;

  @ApiProperty({ enum: ContentStatus, enumName: 'ContentStatus' })
  status: ContentStatus;

  @ApiProperty({ type: Boolean })
  isFree: boolean;

  @ApiProperty({ type: Number, description: '累计参考人数' })
  attemptCount: number;

  @ApiProperty({ type: Number, description: '可作答题数' })
  questionCount: number;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
