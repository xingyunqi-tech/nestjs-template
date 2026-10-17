import { parseAnswerNotation, parseFillNotation, splitLines } from './answer-notation';
import { QuestionType } from '../../questions/domain/question-type';

describe('answer notation', () => {
  describe('parseFillNotation', () => {
    it('should split blanks by || and candidates by |', () => {
      expect(parseFillNotation('北京|北京市||1949')).toEqual([['北京', '北京市'], ['1949']]);
    });

    it('should treat \\| as a literal pipe', () => {
      expect(parseFillNotation('a\\|b||c')).toEqual([['a|b'], ['c']]);
    });

    it('should treat \\\\ as a literal backslash before a separator', () => {
      expect(parseFillNotation('a\\\\|b')).toEqual([['a\\', 'b']]);
    });

    it('should keep other backslashes such as LaTeX commands', () => {
      expect(parseFillNotation('\\frac{1}{2}')).toEqual([['\\frac{1}{2}']]);
    });

    it('should keep empty candidates so validation can reject them', () => {
      expect(parseFillNotation('a||')).toEqual([['a'], ['']]);
    });
  });

  describe('parseAnswerNotation', () => {
    it('should read choice keys and ignore separators', () => {
      expect(parseAnswerNotation(QuestionType.SINGLE, ' b ', '')).toEqual({ keys: ['B'] });
      expect(parseAnswerNotation(QuestionType.MULTIPLE, 'A, C、D', '')).toEqual({ keys: ['A', 'C', 'D'] });
    });

    it('should return undefined for unrecognized choice or judge answers', () => {
      expect(parseAnswerNotation(QuestionType.SINGLE, '甲', '')).toBeUndefined();
      expect(parseAnswerNotation(QuestionType.SINGLE, '', '')).toBeUndefined();
      expect(parseAnswerNotation(QuestionType.JUDGE, '也许', '')).toBeUndefined();
    });

    it('should read judge answers', () => {
      expect(parseAnswerNotation(QuestionType.JUDGE, '对', '')).toEqual({ value: true });
      expect(parseAnswerNotation(QuestionType.JUDGE, '错', '')).toEqual({ value: false });
      expect(parseAnswerNotation(QuestionType.JUDGE, 'TRUE', '')).toEqual({ value: true });
    });

    it('should read fill answers', () => {
      expect(parseAnswerNotation(QuestionType.FILL, '1||2|二', '')).toEqual({ blanks: [['1'], ['2', '二']] });
    });

    it('should read subjective reference and points', () => {
      expect(parseAnswerNotation(QuestionType.SHORT_ANSWER, '参考答案', '要点一\n\n要点二\n')).toEqual({
        reference: '参考答案',
        points: ['要点一', '要点二'],
      });
      expect(parseAnswerNotation(QuestionType.ESSAY, '', '')).toEqual({});
      expect(parseAnswerNotation(QuestionType.ESSAY, '范文', '')).toEqual({ reference: '范文' });
    });
  });

  it('should split non-empty trimmed lines', () => {
    expect(splitLines(' a \n\nb')).toEqual(['a', 'b']);
  });
});
