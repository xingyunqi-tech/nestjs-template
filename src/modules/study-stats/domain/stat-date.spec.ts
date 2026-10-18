import { statDateOf } from './stat-date';

describe('statDateOf', () => {
  it('should use the stat date of the record', () => {
    expect(statDateOf({ statDate: '2026-10-16', gradedAt: new Date('2026-10-17T02:00:00Z') })).toBe('2026-10-16');
  });

  it('should fall back to the Asia/Shanghai date of the grading time', () => {
    expect(statDateOf({ statDate: null, gradedAt: new Date('2026-10-16T16:30:00Z') })).toBe('2026-10-17');
    expect(statDateOf({ statDate: null, gradedAt: new Date('2026-10-16T15:59:59Z') })).toBe('2026-10-16');
  });
});
