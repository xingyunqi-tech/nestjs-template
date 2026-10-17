export enum QuestionStatus {
  DRAFT = 'DRAFT',
  REVIEWING = 'REVIEWING',
  PUBLISHED = 'PUBLISHED',
  OFFLINE = 'OFFLINE',
}

export enum QuestionAction {
  SUBMIT = 'SUBMIT',
  REJECT = 'REJECT',
  PUBLISH = 'PUBLISH',
  OFFLINE = 'OFFLINE',
}

export const QUESTION_TRANSITIONS: Readonly<Record<QuestionAction, { from: QuestionStatus[]; to: QuestionStatus }>> = {
  [QuestionAction.SUBMIT]: { from: [QuestionStatus.DRAFT], to: QuestionStatus.REVIEWING },
  [QuestionAction.REJECT]: { from: [QuestionStatus.REVIEWING], to: QuestionStatus.DRAFT },
  [QuestionAction.PUBLISH]: { from: [QuestionStatus.REVIEWING, QuestionStatus.OFFLINE], to: QuestionStatus.PUBLISHED },
  [QuestionAction.OFFLINE]: { from: [QuestionStatus.PUBLISHED], to: QuestionStatus.OFFLINE },
};

/** 题目状态变化对知识点已发布题目数的影响 */
export function publishedCountDelta(from: QuestionStatus, to: QuestionStatus): number {
  return (to === QuestionStatus.PUBLISHED ? 1 : 0) - (from === QuestionStatus.PUBLISHED ? 1 : 0);
}
