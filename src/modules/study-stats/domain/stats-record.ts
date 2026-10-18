import { PracticeMode } from '../../practice/domain/practice-mode';
import { SelfAssessment } from '../../practice/domain/answer-record';
import { QuestionType } from '../../questions/domain/question-type';

/** 统计事件处理时重读的作答记录 */
export interface StatsRecord {
  id: string;
  sessionId: string;
  userId: number;
  subjectId: string;
  mode: PracticeMode;
  questionId: string;
  questionType: QuestionType;
  /** 题目关联的叶子知识点 */
  knowledgePointIds: string[];
  answer: Record<string, unknown> | null;
  isCorrect: boolean;
  isPartial: boolean;
  selfAssessment: SelfAssessment | null;
  durationSec: number;
  gradedAt: Date | null;
  statDate: string | null;
  firstForQuestion: boolean;
}
