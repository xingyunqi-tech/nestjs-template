import { OutputSegmenter } from './output-segmenter';

const options = { firstMinLength: 5, minLength: 10, maxLength: 20 };

describe('OutputSegmenter', () => {
  it('should hold text until a paragraph ends after the minimum length', () => {
    const segmenter = new OutputSegmenter(options);

    expect(segmenter.push('ab\n\n')).toEqual([]);
    expect(segmenter.push('cccc\n\ngh')).toEqual(['ab\n\ncccc\n\n']);
    expect(segmenter.flush()).toEqual(['gh']);
  });

  it('should use the larger minimum after the first segment', () => {
    const segmenter = new OutputSegmenter(options);
    segmenter.push('first\n\n');

    expect(segmenter.push('short\n\n')).toEqual([]);
    expect(segmenter.push('longer\n\n')).toEqual(['short\n\nlonger\n\n']);
  });

  it('should cut at a sentence end within the maximum length when no paragraph ends', () => {
    const segmenter = new OutputSegmenter(options);

    expect(segmenter.push('一二三四五六七八九十。一二三四五六七八九十一二')).toEqual(['一二三四五六七八九十。']);
    expect(segmenter.flush()).toEqual(['一二三四五六七八九十一二']);
  });

  it('should keep text after the marker as trailer and hold back a partial marker', () => {
    const segmenter = new OutputSegmenter({ ...options, marker: '[[追问]]' });

    expect(segmenter.push('答案是 B。讲解完毕了呢[[追')).toEqual([]);
    expect(segmenter.push('问]]为什么|还有呢')).toEqual(['答案是 B。讲解完毕了呢']);
    expect(segmenter.push('？')).toEqual([]);
    expect(segmenter.trailer).toBe('为什么|还有呢？');
    expect(segmenter.flush()).toEqual([]);
  });

  it('should not split a surrogate pair at the maximum length', () => {
    const segmenter = new OutputSegmenter({ firstMinLength: 1, minLength: 1, maxLength: 4 });

    const segments = segmenter.push('abc😀def');

    expect(segments[0]).toBe('abc');
    expect([...segments, ...segmenter.flush()].join('')).toBe('abc😀def');
  });
});
