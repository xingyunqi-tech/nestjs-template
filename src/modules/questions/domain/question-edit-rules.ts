import { QuestionContent } from './question-content';
import { QuestionType } from './question-type';

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

function optionKeys(content: QuestionContent): string {
  return (content.options ?? [])
    .map((option) => option.key)
    .sort()
    .join(',');
}

function blankCount(content: QuestionContent): number {
  const answer = content.answer;
  return content.type === QuestionType.FILL && answer && 'blanks' in answer ? answer.blanks.length : 0;
}

/** 已发布题目的普通编辑不能改答案、题型、选项 key 集合与填空空数 */
export function isAnswerChange(current: QuestionContent, next: QuestionContent): boolean {
  return (
    current.type !== next.type ||
    canonical(current.answer) !== canonical(next.answer) ||
    optionKeys(current) !== optionKeys(next) ||
    blankCount(current) !== blankCount(next)
  );
}

/** 勘误只改答案内容，不能改题型、选项 key 集合与填空空数 */
export function isErrataCompatible(current: QuestionContent, next: QuestionContent): boolean {
  return (
    current.type === next.type && optionKeys(current) === optionKeys(next) && blankCount(current) === blankCount(next)
  );
}

export function sameKnowledgePoints(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
}

export function isSnapshotChanged(current: QuestionContent, next: QuestionContent): boolean {
  return (
    current.stem !== next.stem ||
    canonical(current.options) !== canonical(next.options) ||
    current.analysis !== next.analysis ||
    current.material !== next.material ||
    current.audioFileId !== next.audioFileId ||
    canonical(current.answer) !== canonical(next.answer) ||
    !sameKnowledgePoints(current.knowledgePointIds, next.knowledgePointIds)
  );
}
