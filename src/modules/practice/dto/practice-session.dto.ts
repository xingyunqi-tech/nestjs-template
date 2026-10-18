import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { PracticeMode } from '../domain/practice-mode';
import { PracticeScope, PracticeSessionStatus, ScoringScheme, SubmitType } from '../domain/practice-session';
import { SelfAssessment } from '../domain/answer-record';
import { HiddenReason } from '../domain/hidden-reason';
import { QuestionType } from '../../questions/domain/question-type';

export class PracticeSessionDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, format: 'uuid' })
  subjectId: string;

  @ApiProperty({ enum: PracticeMode, enumName: 'PracticeMode' })
  mode: PracticeMode;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  paperId: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  dailyDate: string | null;

  @ApiProperty({ type: PracticeScope })
  scope: PracticeScope;

  @ApiProperty({ enum: PracticeSessionStatus, enumName: 'PracticeSessionStatus' })
  status: PracticeSessionStatus;

  @ApiProperty({ type: Number, description: '可作答题数' })
  questionCount: number;

  @ApiProperty({ type: Number })
  answeredCount: number;

  @ApiProperty({ type: Number })
  correctCount: number;

  @ApiProperty({ type: Number })
  durationSec: number;

  @ApiProperty({ type: Number })
  lastIndex: number;

  @ApiProperty()
  startedAt: Date;

  @ApiProperty({ type: Date, nullable: true })
  deadlineAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  autoSubmitAt: Date | null;

  @ApiProperty({ type: Date, nullable: true })
  submittedAt: Date | null;

  @ApiProperty({ enum: SubmitType, enumName: 'SubmitType', nullable: true })
  submitType: SubmitType | null;

  @ApiProperty()
  lastActiveAt: Date;

  @ApiProperty({ type: Boolean })
  isFirstAttempt: boolean;

  @ApiProperty({ enum: ScoringScheme, enumName: 'ScoringScheme', nullable: true })
  scoringScheme: ScoringScheme | null;

  @ApiProperty({ type: Number, nullable: true })
  score: number | null;

  @ApiProperty({ type: Number, nullable: true })
  totalScore: number | null;

  @ApiProperty({ type: Boolean })
  pendingGrading: boolean;
}

export class AnswerCardItemDto {
  @ApiProperty({ type: Number })
  index: number;

  @ApiProperty({ type: String, format: 'uuid' })
  questionId: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true, description: '所属材料' })
  materialId: string | null;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType' })
  type: QuestionType;

  @ApiProperty({ type: Boolean })
  answered: boolean;

  @ApiProperty({ type: Boolean, nullable: true })
  isCorrect: boolean | null;

  @ApiProperty({ type: Boolean })
  isPartial: boolean;

  @ApiProperty({ enum: SelfAssessment, enumName: 'SelfAssessment', nullable: true })
  selfAssessment: SelfAssessment | null;

  @ApiProperty({ type: Boolean })
  markedForReview: boolean;

  @ApiProperty({ enum: HiddenReason, enumName: 'HiddenReason', nullable: true })
  hiddenReason: HiddenReason | null;
}

export class PracticeSessionDetailDto extends PracticeSessionDto {
  @ApiProperty({ description: '服务端当前时间，用于校准倒计时' })
  serverNow: Date;

  @ApiProperty({ type: [AnswerCardItemDto] })
  card: AnswerCardItemDto[];
}

export class CreatePracticeSessionResultDto extends PracticeSessionDetailDto {
  @ApiProperty({ type: Boolean, description: '可出题数少于请求题量' })
  insufficient: boolean;

  @ApiProperty({
    type: Boolean,
    description: '请求设备是否为当前作答设备；模考已结束或截止后以新设备进入时为 false',
  })
  isActiveDevice: boolean;
}

export class QueryPracticeSessionsDto {
  @ApiPropertyOptional({ type: Number, default: 1 })
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 1))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ type: Number, default: 20, maximum: 50 })
  @IsOptional()
  @Transform(({ value }) => (value ? Number(value) : 20))
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: PracticeMode, enumName: 'PracticeMode' })
  @IsOptional()
  @IsEnum(PracticeMode)
  mode?: PracticeMode;

  @ApiPropertyOptional({ enum: PracticeSessionStatus, enumName: 'PracticeSessionStatus' })
  @IsOptional()
  @IsEnum(PracticeSessionStatus)
  status?: PracticeSessionStatus;
}

export class QueryOngoingSessionsDto {
  @ApiPropertyOptional({
    enum: PracticeMode,
    enumName: 'PracticeMode',
    isArray: true,
    description: '排除的模式，可重复传参或以逗号分隔',
  })
  @IsOptional()
  @Transform(({ value }) =>
    ([] as unknown[])
      .concat(value)
      .flatMap((item) => String(item).split(','))
      .map((item) => item.trim())
      .filter(Boolean),
  )
  @IsEnum(PracticeMode, { each: true })
  excludeModes?: PracticeMode[];
}

export class ProgressDto {
  @ApiProperty({ type: Number, description: '最近浏览位置，从 0 开始' })
  @IsInt()
  @Min(0)
  lastIndex: number;
}
