import { isWeak, masteryOf, masteryOfResults } from './mastery';

describe('mastery', () => {
  it('should weight the recent accuracy by 0.7 and the overall accuracy by 0.3', () => {
    expect(masteryOf({ answered: 40, correct: 20, recentAnswered: 20, recentCorrect: 16 })).toBe(71);
  });

  it('should return null when answered fewer than five times', () => {
    expect(masteryOfResults(4, 4, [1, 1, 1, 1])).toBeNull();
    expect(masteryOfResults(5, 5, [1, 1, 1, 1, 1])).toBe(100);
  });

  it('should use only the latest twenty results as the recent accuracy', () => {
    const results = [...Array<number>(10).fill(0), ...Array<number>(20).fill(1)];

    expect(masteryOfResults(30, 20, results)).toBe(90);
  });

  it('should round to two decimals', () => {
    expect(masteryOfResults(6, 1, [1, 0, 0, 0, 0, 0])).toBe(16.67);
  });

  it('should treat leaves answered at least five times with mastery below 60 as weak', () => {
    expect(isWeak(8, 45)).toBe(true);
    expect(isWeak(8, 60)).toBe(false);
    expect(isWeak(4, 10)).toBe(false);
    expect(isWeak(8, null)).toBe(false);
  });
});
