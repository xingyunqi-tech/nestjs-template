import { ApiProperty } from '@nestjs/swagger';
import { QuestionType } from '../../questions/domain/question-type';
import { SelfAssessment } from '../domain/answer-record';
import { HiddenReason } from '../domain/hidden-reason';
import { PracticeSessionDto } from './practice-session.dto';

export enum AnswerCardStatus {
  CORRECT = 'CORRECT',
  WRONG = 'WRONG',
  PARTIAL = 'PARTIAL',
  UNANSWERED = 'UNANSWERED',
  PENDING_SELF_ASSESSMENT = 'PENDING_SELF_ASSESSMENT',
}

export class ReportCardItemDto {
  @ApiProperty({ type: Number })
  index: number;

  @ApiProperty({ type: String, format: 'uuid' })
  questionId: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: '所属材料' })
  materialId: string | null;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType' })
  type: QuestionType;

  @ApiProperty({
    enum: AnswerCardStatus,
    enumName: 'AnswerCardStatus',
    nullable: true,
    description: '答案不可见时为空',
  })
  status: AnswerCardStatus | null;

  @ApiProperty({ type: Number, nullable: true, description: '得分，仅模拟考试' })
  score: number | null;

  @ApiProperty({ type: Number, nullable: true, description: '题目分值，仅模拟考试' })
  fullScore: number | null;

  @ApiProperty({ enum: SelfAssessment, enumName: 'SelfAssessment', nullable: true })
  selfAssessment: SelfAssessment | null;

  @ApiProperty({ type: Boolean })
  markedForReview: boolean;

  @ApiProperty({ enum: HiddenReason, enumName: 'HiddenReason', nullable: true })
  hiddenReason: HiddenReason | null;
}

export class AccuracyDto {
  @ApiProperty({ type: Number, description: '题数' })
  total: number;

  @ApiProperty({ type: Number })
  answered: number;

  @ApiProperty({ type: Number })
  correct: number;

  @ApiProperty({ type: Number, description: '正确率 = correct / total，0~1' })
  accuracy: number;
}

export class TypeAccuracyDto extends AccuracyDto {
  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType' })
  type: QuestionType;
}

export class KnowledgePointAccuracyDto extends AccuracyDto {
  @ApiProperty({ type: String, format: 'uuid' })
  knowledgePointId: string;

  @ApiProperty({ type: String })
  name: string;
}

export class PercentileDto {
  @ApiProperty({ type: Number, nullable: true, description: '超过的用户比例，0~1；没有可比较的成绩时为空' })
  beatRatio: number | null;

  @ApiProperty({ type: Number, description: '相同计分口径下其他用户首次交卷的成绩数' })
  sampleSize: number;
}

export class SelfAssessmentEntryDto {
  @ApiProperty({ type: String, format: 'uuid', isArray: true, description: '已作答、待自评的主观题' })
  pendingQuestionIds: string[];
}

export class PracticeReportDto {
  @ApiProperty({ type: PracticeSessionDto })
  session: PracticeSessionDto;

  @ApiProperty({ type: Number, nullable: true, description: '得分，仅模拟考试（P0 为客观题得分）' })
  score: number | null;

  @ApiProperty({ type: Number, nullable: true, description: '满分，仅模拟考试' })
  totalScore: number | null;

  @ApiProperty({ type: Number })
  questionCount: number;

  @ApiProperty({ type: Number })
  answeredCount: number;

  @ApiProperty({ type: Number, description: '答对题数，不含当前答案不可见的题' })
  correctCount: number;

  @ApiProperty({ type: Number, description: '正确率 = correctCount / questionCount，0~1' })
  accuracy: number;

  @ApiProperty({ type: Number, description: '用时（秒）' })
  durationSec: number;

  @ApiProperty({
    type: PercentileDto,
    nullable: true,
    description: '仅已交卷的模拟考试；按规则生成的试卷不展示',
  })
  percentile: PercentileDto | null;

  @ApiProperty({ type: [TypeAccuracyDto] })
  byType: TypeAccuracyDto[];

  @ApiProperty({ type: [KnowledgePointAccuracyDto] })
  byKnowledgePoint: KnowledgePointAccuracyDto[];

  @ApiProperty({ type: [ReportCardItemDto] })
  card: ReportCardItemDto[];

  @ApiProperty({ type: SelfAssessmentEntryDto })
  selfAssessment: SelfAssessmentEntryDto;

  @ApiProperty({ type: Number, description: '本次错题数，用于「本次错题重做」' })
  wrongQuestionCount: number;
}
