import { PracticeSession } from './domain/practice-session';
import { AnswerRecord } from './domain/answer-record';
import { PracticeSessionDto } from './dto/practice-session.dto';
import { AnswerStateDto } from './dto/answer-state.dto';
import { Visibility } from './answer-visibility.service';

export function toPracticeSessionDto<T extends PracticeSessionDto>(
  session: PracticeSession,
  target: T = new PracticeSessionDto() as T,
): T {
  target.id = session.id;
  target.subjectId = session.subjectId;
  target.mode = session.mode;
  target.paperId = session.paperId;
  target.dailyDate = session.dailyDate;
  target.scope = { ...session.scope };
  target.status = session.status;
  target.questionCount = session.questionIds.length;
  target.answeredCount = session.answeredCount;
  target.correctCount = session.correctCount;
  target.durationSec = session.durationSec;
  target.lastIndex = session.lastIndex;
  target.startedAt = session.startedAt;
  target.deadlineAt = session.deadlineAt;
  target.autoSubmitAt = session.autoSubmitAt;
  target.submittedAt = session.submittedAt;
  target.submitType = session.submitType;
  target.lastActiveAt = session.lastActiveAt;
  target.isFirstAttempt = session.isFirstAttempt;
  target.scoringScheme = session.scoringScheme;
  target.score = session.score;
  target.totalScore = session.totalScore;
  target.pendingGrading = session.pendingGrading;
  return target;
}

export function toAnswerState(record: AnswerRecord | undefined, visibility: Visibility): AnswerStateDto | null {
  if (!record) {
    return null;
  }
  const dto = new AnswerStateDto();
  dto.answer = record.answer;
  dto.isCorrect = visibility.visible ? record.isCorrect : null;
  dto.isPartial = visibility.visible ? record.isPartial : false;
  dto.score = visibility.visible ? record.score : null;
  dto.selfAssessment = visibility.visible ? record.selfAssessment : null;
  dto.markedForReview = record.markedForReview;
  dto.durationSec = record.durationSec;
  dto.clientSeq = record.clientSeq;
  dto.answeredAt = record.answeredAt;
  dto.gradedAt = visibility.visible ? record.gradedAt : null;
  return dto;
}
