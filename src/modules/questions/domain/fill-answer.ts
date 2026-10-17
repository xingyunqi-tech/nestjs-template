const FULL_WIDTH_ASCII = /[！-～]/g;
const FULL_WIDTH_OFFSET = 0xfee0;
const THOUSANDS_SEPARATOR = /(\d),(?=\d{3}(?!\d))/g;

/** 去首尾空白、全角转半角、英文忽略大小写、数字去千分位 */
export function normalizeFillBlank(value: string): string {
  return value
    .replace(FULL_WIDTH_ASCII, (char) => String.fromCharCode(char.charCodeAt(0) - FULL_WIDTH_OFFSET))
    .replace(/　/g, ' ')
    .trim()
    .toLowerCase()
    .replace(THOUSANDS_SEPARATOR, '$1');
}

export function matchFillBlank(candidates: string[], value: string): boolean {
  const normalized = normalizeFillBlank(value);
  return candidates.some((candidate) => normalizeFillBlank(candidate) === normalized);
}
