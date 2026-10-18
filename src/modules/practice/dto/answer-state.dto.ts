import { ApiProperty } from '@nestjs/swagger';
import { SelfAssessment } from '../domain/answer-record';

/** 作答状态；判分结果在答案不可见时为空 */
export class AnswerStateDto {
  @ApiProperty({ type: Object, nullable: true, description: '用户答案，为空表示仅标记' })
  answer: Record<string, unknown> | null;

  @ApiProperty({ type: Boolean, nullable: true })
  isCorrect: boolean | null;

  @ApiProperty({ type: Boolean })
  isPartial: boolean;

  @ApiProperty({ type: Number, nullable: true, description: '仅模拟考试' })
  score: number | null;

  @ApiProperty({ enum: SelfAssessment, enumName: 'SelfAssessment', nullable: true })
  selfAssessment: SelfAssessment | null;

  @ApiProperty({ type: Boolean })
  markedForReview: boolean;

  @ApiProperty({ type: Number })
  durationSec: number;

  @ApiProperty({ type: Number })
  clientSeq: number;

  @ApiProperty()
  answeredAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  gradedAt: Date | null;
}
