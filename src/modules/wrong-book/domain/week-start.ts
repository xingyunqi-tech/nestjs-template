import { businessDate } from '../../papers/domain/business-date';

const DAY_MS = 86_400_000;

/** Asia/Shanghai 本周一零点 */
export function businessWeekStart(at: Date = new Date()): Date {
  const today = Date.parse(`${businessDate(at)}T00:00:00Z`);
  const offset = (new Date(today).getUTCDay() + 6) % 7;
  const monday = new Date(today - offset * DAY_MS).toISOString().slice(0, 10);
  return new Date(`${monday}T00:00:00+08:00`);
}
