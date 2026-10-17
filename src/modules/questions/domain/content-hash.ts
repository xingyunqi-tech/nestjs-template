import { createHash } from 'crypto';
import { QuestionContent } from './question-content';
import { QuestionType } from './question-type';

type HashableContent = Pick<QuestionContent, 'type' | 'stem' | 'options' | 'material' | 'audioFileId'>;

export function normalizeForHash(text: string): string {
  return text.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** 独立题 = 题干 + 选项；小题 = 材料哈希 + 题干 + 选项；材料 = 题干 + 材料 + 音频 */
export function computeContentHash(content: HashableContent, materialHash: string | null): string {
  const stem = normalizeForHash(content.stem);
  if (content.type === QuestionType.MATERIAL) {
    return sha256(['MATERIAL', stem, normalizeForHash(content.material ?? ''), content.audioFileId ?? null]);
  }
  const options = [...(content.options ?? [])]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((option) => [option.key, normalizeForHash(option.content)]);
  return sha256(materialHash ? [materialHash, stem, options] : [stem, options]);
}
