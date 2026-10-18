import { ApiProperty } from '@nestjs/swagger';
import { QuestionType } from '../../questions/domain/question-type';
import { PracticeMode } from './practice-mode';

export enum PracticeSessionStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  SUBMITTED = 'SUBMITTED',
  ABANDONED = 'ABANDONED',
}

export enum SubmitType {
  MANUAL = 'MANUAL',
  AUTO_TIMEOUT = 'AUTO_TIMEOUT',
}

export enum ScoringScheme {
  OBJECTIVE_ONLY = 'OBJECTIVE_ONLY',
  FULL = 'FULL',
}

export class PracticeScope {
  @ApiProperty({ type: String, format: 'uuid', required: false })
  knowledgePointId?: string;

  @ApiProperty({ enum: QuestionType, enumName: 'QuestionType', required: false })
  questionType?: QuestionType;

  @ApiProperty({ type: String, format: 'uuid', required: false })
  fromSessionId?: string;
}

export class PracticeSession {
  id: string;
  userId: number;
  subjectId: string;
  mode: PracticeMode;
  paperId: string | null;
  dailyDate: string | null;
  scope: PracticeScope;
  /** 可作答题目，同一材料的小题连续 */
  questionIds: string[];
  questionVersions: Record<string, number>;
  status: PracticeSessionStatus;
  activeDeviceId: string | null;
  startedAt: Date;
  deadlineAt: Date | null;
  autoSubmitAt: Date | null;
  submittedAt: Date | null;
  submitType: SubmitType | null;
  lastActiveAt: Date;
  isFirstAttempt: boolean;
  scoringScheme: ScoringScheme | null;
  score: number | null;
  totalScore: number | null;
  correctCount: number;
  answeredCount: number;
  durationSec: number;
  lastIndex: number;
  pendingGrading: boolean;
  createdAt: Date;
  updatedAt: Date;
}
