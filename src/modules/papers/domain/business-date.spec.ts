import { businessDate, daysBetween } from './business-date';

describe('businessDate', () => {
  it('should use the Asia/Shanghai calendar day', () => {
    expect(businessDate(new Date('2026-10-16T15:59:59Z'))).toBe('2026-10-16');
    expect(businessDate(new Date('2026-10-16T16:00:00Z'))).toBe('2026-10-17');
  });

  it('should count calendar days between dates', () => {
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetween('2026-10-02', '2026-10-01')).toBe(-1);
  });
});
