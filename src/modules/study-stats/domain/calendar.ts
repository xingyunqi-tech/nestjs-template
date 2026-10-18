const DAY_MS = 86_400_000;

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** from 至 to（均含）的每一天 */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

/** YYYY-MM 的首日与末日 */
export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const [year, monthIndex] = month.split('-').map(Number);
  const to = new Date(Date.UTC(year, monthIndex, 0)).toISOString().slice(0, 10);
  return { from, to };
}
