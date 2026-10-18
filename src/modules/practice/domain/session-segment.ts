/** 将 [from, from + size) 扩展到材料边界；groupKeys 为每道题所属的材料或自身 id */
export function alignSegment(groupKeys: string[], from: number, size: number): { start: number; end: number } {
  const total = groupKeys.length;
  if (from >= total || size <= 0) {
    return { start: Math.min(from, total), end: Math.min(from, total) };
  }
  let start = Math.max(0, from);
  let end = Math.min(total, start + size);
  while (start > 0 && groupKeys[start - 1] === groupKeys[start]) {
    start -= 1;
  }
  while (end < total && groupKeys[end] === groupKeys[end - 1]) {
    end += 1;
  }
  return { start, end };
}
