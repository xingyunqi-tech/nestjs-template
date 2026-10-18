export enum SelfAssessment {
  KNOWN = 'KNOWN',
  UNKNOWN = 'UNKNOWN',
}

export enum GradingStatus {
  PENDING = 'PENDING',
  DONE = 'DONE',
  FAILED = 'FAILED',
}

export const MAX_ANSWER_DURATION_SEC = 600;

export class AnswerRecord {
  id: string;
  sessionId: string;
  userId: number;
  questionId: string;
  questionVersion: number;
  /** 为空表示已清空或仅标记 */
  answer: Record<string, unknown> | null;
  isCorrect: boolean | null;
  isPartial: boolean;
  score: number | null;
  selfAssessment: SelfAssessment | null;
  gradingStatus: GradingStatus | null;
  gradingTaskId: string | null;
  durationSec: number;
  markedForReview: boolean;
  deviceId: string;
  clientSeq: number;
  clientAnsweredAt: Date;
  answeredAt: Date;
  gradedAt: Date | null;
  statDate: string | null;
  statsAppliedAt: Date | null;
  firstForQuestion: boolean;
  createdAt: Date;
  updatedAt: Date;
}
