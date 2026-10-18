import { businessWeekStart } from './week-start';

describe('businessWeekStart', () => {
  it('should return Monday midnight in Asia/Shanghai for a mid-week instant', () => {
    expect(businessWeekStart(new Date('2026-10-15T10:00:00+08:00')).toISOString()).toBe('2026-10-11T16:00:00.000Z');
  });

  it('should start the week on Monday itself', () => {
    expect(businessWeekStart(new Date('2026-10-12T00:00:00+08:00')).toISOString()).toBe('2026-10-11T16:00:00.000Z');
  });

  it('should keep Sunday night in the week that started the previous Monday', () => {
    expect(businessWeekStart(new Date('2026-10-18T23:59:59+08:00')).toISOString()).toBe('2026-10-11T16:00:00.000Z');
  });

  it('should use the Shanghai date when UTC is still on Sunday', () => {
    expect(businessWeekStart(new Date('2026-10-18T16:30:00Z')).toISOString()).toBe('2026-10-18T16:00:00.000Z');
  });
});
