import { alignSegment } from './session-segment';

describe('alignSegment', () => {
  const keys = ['q0', 'q1', 'm', 'm', 'm', 'q5'];

  it('should extend the end to the whole material', () => {
    expect(alignSegment(keys, 0, 3)).toEqual({ start: 0, end: 5 });
  });

  it('should extend the start back to the first sub question', () => {
    expect(alignSegment(keys, 3, 1)).toEqual({ start: 2, end: 5 });
  });

  it('should keep segments that already end on a boundary', () => {
    expect(alignSegment(keys, 0, 2)).toEqual({ start: 0, end: 2 });
    expect(alignSegment(keys, 5, 10)).toEqual({ start: 5, end: 6 });
  });

  it('should return an empty segment beyond the end', () => {
    expect(alignSegment(keys, 9, 3)).toEqual({ start: 6, end: 6 });
  });
});
