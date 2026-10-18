import { positiveInteger } from './number.utils';

describe('positiveInteger', () => {
  it('should return positive integers as is', () => {
    expect(positiveInteger(5, 3)).toBe(5);
  });

  it('should fall back for non-positive, fractional and non-number values', () => {
    for (const value of [0, -1, 1.5, '5', null, undefined, Number.NaN]) {
      expect(positiveInteger(value, 3)).toBe(3);
    }
  });
});
