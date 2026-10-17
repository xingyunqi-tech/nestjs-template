import { matchFillBlank, normalizeFillBlank } from './fill-answer';

describe('fill answer normalization', () => {
  it('should trim surrounding whitespace including ideographic spaces', () => {
    expect(normalizeFillBlank('　 答案 \t')).toBe('答案');
  });

  it('should convert full-width characters to half-width', () => {
    expect(normalizeFillBlank('Ａ１２３（ｘ）')).toBe('a123(x)');
  });

  it('should ignore English letter case', () => {
    expect(normalizeFillBlank('Beijing')).toBe(normalizeFillBlank('BEIJING'));
  });

  it('should remove thousands separators from numbers', () => {
    expect(normalizeFillBlank('1,234,567')).toBe('1234567');
    expect(normalizeFillBlank('１，０００元')).toBe('1000元');
  });

  it('should keep commas that are not thousands separators', () => {
    expect(normalizeFillBlank('3,14')).toBe('3,14');
    expect(normalizeFillBlank('12,3456')).toBe('12,3456');
    expect(normalizeFillBlank('a,b')).toBe('a,b');
  });

  it('should match any candidate after normalization', () => {
    expect(matchFillBlank(['一千', '1000'], ' 1,000 ')).toBe(true);
    expect(matchFillBlank(['Paris'], 'PARIS')).toBe(true);
    expect(matchFillBlank(['2024'], '２０２４')).toBe(true);
    expect(matchFillBlank(['Paris'], 'London')).toBe(false);
  });
});
