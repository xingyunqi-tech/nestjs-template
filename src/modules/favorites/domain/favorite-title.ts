const TITLE_MAX_LENGTH = 200;
const MARKDOWN_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;

/** 题干的标题快照 */
export function questionTitle(stem: string): string {
  return stem.replace(MARKDOWN_IMAGE, '[图片]').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_LENGTH);
}

export function snapshotTitle(title: string): string {
  return title.slice(0, TITLE_MAX_LENGTH);
}
