import { QuestionType } from '../../questions/domain/question-type';
import { isSubjectiveType } from '../../practice/domain/answer-content';

export type WrongBookOutcome = 'wrong' | 'correct' | 'ignored';

/** 判错（含部分正确与自评 UNKNOWN）计为错误；主观题判对与缺少统计日的判对不计入连续答对 */
export function wrongBookOutcomeOf(record: {
  isCorrect: boolean;
  questionType: QuestionType;
  statDate: string | null;
}): WrongBookOutcome {
  if (!record.isCorrect) {
    return 'wrong';
  }
  if (isSubjectiveType(record.questionType) || !record.statDate) {
    return 'ignored';
  }
  return 'correct';
}
