import { QuestionType } from '../../questions/domain/question-type';
import { isObjectiveType } from '../../questions/domain/objective-grading';
import { isImmediateMode, PracticeMode } from './practice-mode';
import { PracticeSession, PracticeSessionStatus } from './practice-session';
import { AnswerRecord } from './answer-record';
import { isSubjectiveType } from './answer-content';

export interface SessionAnswerContext {
  questionType: QuestionType;
  session?: Pick<PracticeSession, 'mode' | 'status'> | null;
  record?: Pick<AnswerRecord, 'answer' | 'isCorrect'> | null;
}

/** 可见性规则 1-3：背题；答完即判中客观题已判分、主观题已提交；模考已交卷 */
export function revealedBySession({ questionType, session, record }: SessionAnswerContext): boolean {
  if (!session) {
    return false;
  }
  if (session.mode === PracticeMode.MEMORIZE) {
    return true;
  }
  if (session.mode === PracticeMode.MOCK) {
    return session.status === PracticeSessionStatus.SUBMITTED;
  }
  const answer = record?.answer ?? null;
  if (!isImmediateMode(session.mode) || answer === null) {
    return false;
  }
  if (isObjectiveType(questionType)) {
    return (record?.isCorrect ?? null) !== null;
  }
  return isSubjectiveType(questionType);
}
