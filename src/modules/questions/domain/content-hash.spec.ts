import { computeContentHash } from './content-hash';
import { QuestionType } from './question-type';

const single = (
  stem: string,
  options = [
    { key: 'A', content: '对' },
    { key: 'B', content: '错' },
  ],
) => ({ type: QuestionType.SINGLE, stem, options, material: null, audioFileId: null });

const material = (text: string | null, audioFileId: string | null = null) => ({
  type: QuestionType.MATERIAL,
  stem: '听力材料',
  options: null,
  material: text,
  audioFileId,
});

describe('computeContentHash', () => {
  it('should treat whitespace and full-width differences as the same content', () => {
    expect(computeContentHash(single('  下列说法  正确的是？ '), null)).toBe(
      computeContentHash(single('下列说法 正确的是?'), null),
    );
  });

  it('should ignore option order', () => {
    const reversed = single('题干', [
      { key: 'B', content: '错' },
      { key: 'A', content: '对' },
    ]);
    expect(computeContentHash(reversed, null)).toBe(computeContentHash(single('题干'), null));
  });

  it('should distinguish different stems and options', () => {
    const base = computeContentHash(single('题干'), null);
    expect(computeContentHash(single('另一题干'), null)).not.toBe(base);
    expect(
      computeContentHash(
        single('题干', [
          { key: 'A', content: '对' },
          { key: 'B', content: '不对' },
        ]),
        null,
      ),
    ).not.toBe(base);
  });

  it('should include the material hash for sub-questions', () => {
    const first = computeContentHash(material(null, 'audio-1'), null);
    const second = computeContentHash(material(null, 'audio-2'), null);
    const stem = single('What does the man mean?');

    expect(first).not.toBe(second);
    expect(computeContentHash(stem, first)).not.toBe(computeContentHash(stem, second));
    expect(computeContentHash(stem, first)).not.toBe(computeContentHash(stem, null));
  });

  it('should hash materials by stem, material text and audio', () => {
    expect(computeContentHash(material('资料 一'), null)).toBe(computeContentHash(material('资料  一 '), null));
    expect(computeContentHash(material('资料一'), null)).not.toBe(computeContentHash(material('资料二'), null));
  });
});
