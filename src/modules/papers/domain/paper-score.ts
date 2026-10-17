import { QuestionType } from '../../questions/domain/question-type';
import { isObjectiveType } from '../../questions/domain/objective-grading';

const toCents = (score: number): number => Math.round(score * 100);

export function sumPaperScores(items: { type: QuestionType; score: number }[]): {
  totalScore: number;
  objectiveScore: number;
} {
  let total = 0;
  let objective = 0;
  for (const item of items) {
    const cents = toCents(item.score);
    total += cents;
    if (isObjectiveType(item.type)) {
      objective += cents;
    }
  }
  return { totalScore: total / 100, objectiveScore: objective / 100 };
}
