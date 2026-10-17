import { sumPaperScores } from './paper-score';
import { QuestionType } from '../../questions/domain/question-type';

describe('sumPaperScores', () => {
  it('should sum all scores and objective scores without float drift', () => {
    expect(
      sumPaperScores([
        { type: QuestionType.SINGLE, score: 0.1 },
        { type: QuestionType.FILL, score: 0.2 },
        { type: QuestionType.ESSAY, score: 30.55 },
        { type: QuestionType.MULTIPLE, score: 1.7 },
      ]),
    ).toEqual({ totalScore: 32.55, objectiveScore: 2 });
  });

  it('should return zero for an empty paper', () => {
    expect(sumPaperScores([])).toEqual({ totalScore: 0, objectiveScore: 0 });
  });
});
