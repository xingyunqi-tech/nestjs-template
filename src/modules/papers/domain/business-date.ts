const BUSINESS_TIME_ZONE = 'Asia/Shanghai';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Asia/Shanghai 的日期，格式 YYYY-MM-DD */
export function businessDate(at: Date = new Date()): string {
  return formatter.format(at);
}

/** Asia/Shanghai 当日零点 */
export function businessDayStart(at: Date = new Date()): Date {
  return new Date(`${businessDate(at)}T00:00:00+08:00`);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
