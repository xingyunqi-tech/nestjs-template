import { ApiProperty } from '@nestjs/swagger';
import { PaperType } from '../domain/paper-type';
import { MultiScoringRule } from '../domain/multi-scoring-rule';
import { PaperSection } from '../domain/paper-section';

export class PublicPaperDto {
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

  @ApiProperty({ type: Number })
  durationMin: number;

  @ApiProperty({ type: Number })
  questionCount: number;

  @ApiProperty({ type: Number })
  totalScore: number;

  @ApiProperty({ type: Boolean })
  isFree: boolean;

  @ApiProperty({ type: Number, description: '参考人数' })
  attemptCount: number;

  @ApiProperty({ type: Number, nullable: true, description: '登录用户最近一次成绩' })
  lastScore: number | null;

  @ApiProperty({ type: Number, nullable: true, description: '登录用户最高分' })
  bestScore: number | null;
}

export class PublicPaperSectionDto extends PaperSection {
  @ApiProperty({ type: Number })
  questionCount: number;
}

export class PublicPaperDetailDto extends PublicPaperDto {
  @ApiProperty({ type: [PublicPaperSectionDto] })
  sections: PublicPaperSectionDto[];

  @ApiProperty({ type: Number })
  objectiveScore: number;

  @ApiProperty({ enum: MultiScoringRule, enumName: 'MultiScoringRule' })
  multiScoringRule: MultiScoringRule;
}
