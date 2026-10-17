import { ApiProperty } from '@nestjs/swagger';
import { PaperSection } from '../domain/paper-section';
import { QuestionType } from '../../questions/domain/question-type';

export class PaperDraftQuestionDto {
  @ApiProperty({ type: Number })
  sectionIndex: number;

  @ApiProperty({ type: String, format: 'uuid' })
  questionId: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: '所属材料' })
  parentId: string | null;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType' })
  type: QuestionType;

  @ApiProperty({ type: Number })
  questionVersion: number;

  @ApiProperty({ type: Number })
  score: number;

  @ApiProperty({ type: String })
  stem: string;
}

export class PaperRuleShortageDto {
  @ApiProperty({ type: Number })
  itemIndex: number;

  @ApiProperty({ type: Number })
  requested: number;

  @ApiProperty({ type: Number })
  drawn: number;
}

export class PaperDraftDto {
  @ApiProperty({ type: [PaperSection] })
  sections: PaperSection[];

  @ApiProperty({ type: [PaperDraftQuestionDto] })
  questions: PaperDraftQuestionDto[];

  @ApiProperty({ type: Number })
  questionCount: number;

  @ApiProperty({ type: Number })
  totalScore: number;

  @ApiProperty({ type: Number })
  objectiveScore: number;

  @ApiProperty({ type: [PaperRuleShortageDto], description: '题量不足的规则项' })
  insufficient: PaperRuleShortageDto[];
}
