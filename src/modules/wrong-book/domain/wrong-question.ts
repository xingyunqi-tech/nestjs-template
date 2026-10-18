export enum WrongQuestionStatus {
  ACTIVE = 'ACTIVE',
  MASTERED = 'MASTERED',
}

export class WrongQuestion {
  id: string;
  userId: number;
  questionId: string;
  subjectId: string;
  wrongCount: number;
  /** 进入当前 ACTIVE 状态后的连续答对次数 */
  consecutiveCorrect: number;
  /** 最近一次计入连续答对的统计日 */
  lastCorrectDate: string | null;
  lastWrongAnswer: Record<string, unknown> | null;
  firstWrongAt: Date;
  lastWrongAt: Date;
  status: WrongQuestionStatus;
  masteredAt: Date | null;
  aiAnalysis: string | null;
  aiAnalysisVersion: number | null;
  createdAt: Date;
  updatedAt: Date;
}
