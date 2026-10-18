export const RECENT_RESULTS_LIMIT = 20;
export const MASTERY_MIN_ANSWERED = 5;
export const WEAK_MASTERY_THRESHOLD = 60;

export interface MasteryInput {
  answered: number;
  correct: number;
  recentAnswered: number;
  recentCorrect: number;
}

/** 百分制两位小数；作答不足 5 次为 null */
export function masteryOf(input: MasteryInput): number | null {
  if (input.answered < MASTERY_MIN_ANSWERED || input.recentAnswered === 0) {
    return null;
  }
  const recentRate = input.recentCorrect / input.recentAnswered;
  const totalRate = input.correct / input.answered;
  return Math.round((recentRate * 0.7 + totalRate * 0.3) * 10_000) / 100;
}

export function masteryOfResults(answered: number, correct: number, recentResults: number[]): number | null {
  const recent = recentResults.slice(-RECENT_RESULTS_LIMIT);
  return masteryOf({
    answered,
    correct,
    recentAnswered: recent.length,
    recentCorrect: recent.filter((value) => value === 1).length,
  });
}

export function isWeak(answered: number, mastery: number | null): mastery is number {
  return answered >= MASTERY_MIN_ANSWERED && mastery !== null && mastery < WEAK_MASTERY_THRESHOLD;
}
