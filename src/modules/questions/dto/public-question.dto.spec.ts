import { toPublicQuestion } from './public-question.dto';
import { Question } from '../domain/question';
import { QuestionVersion, QuestionChangeType } from '../domain/question-version';
import { QuestionType } from '../domain/question-type';
import { QuestionStatus } from '../domain/question-status';
import { QuestionSource } from '../domain/question-source';

const question = Object.assign(new Question(), {
  id: 'q1',
  subjectId: 's1',
  parentId: null,
  type: QuestionType.SINGLE,
  currentVersion: 2,
  stem: '当前题干',
  options: [
    { key: 'A', content: '甲' },
    { key: 'B', content: '乙' },
  ],
  answer: { keys: ['B'] },
  analysis: '解析',
  difficulty: 3,
  knowledgePointIds: ['k1'],
  material: null,
  audioFileId: null,
  source: QuestionSource.ORIGINAL,
  sourceNote: null,
  status: QuestionStatus.PUBLISHED,
  isFree: true,
  sort: 0,
  contentHash: 'h',
  statAnswered: 10,
  statCorrect: 5,
});

describe('toPublicQuestion', () => {
  it('should exclude answer, analysis and internal fields', () => {
    const dto = toPublicQuestion(question);

    expect(dto).toMatchObject({
      id: 'q1',
      version: 2,
      stem: '当前题干',
      knowledgePointIds: ['k1'],
      audioUrl: null,
      blankCount: null,
    });
    for (const key of ['answer', 'analysis', 'contentHash', 'statAnswered', 'statCorrect', 'status', 'source']) {
      expect(dto).not.toHaveProperty(key);
    }
  });

  it('should take the content from the given version snapshot', () => {
    const version = Object.assign(new QuestionVersion(), {
      questionId: 'q1',
      version: 1,
      type: QuestionType.SINGLE,
      stem: '旧题干',
      options: question.options,
      answer: { keys: ['B'] },
      analysis: '旧解析',
      material: null,
      audioFileId: null,
      knowledgePointIds: ['k0'],
      materialVersion: null,
      changeType: QuestionChangeType.PUBLISH,
    });

    const dto = toPublicQuestion(question, version);

    expect(dto).toMatchObject({ version: 1, stem: '旧题干', knowledgePointIds: ['k1'] });
    expect(dto).not.toHaveProperty('analysis');
  });

  it('should expose the blank count of a fill question without its answer', () => {
    const fill = Object.assign(new Question(), question, {
      type: QuestionType.FILL,
      options: null,
      answer: { blanks: [['甲'], ['乙', '丙']] },
    });

    const dto = toPublicQuestion(fill);

    expect(dto.blankCount).toBe(2);
    expect(JSON.stringify(dto)).not.toMatch(/blanks|"甲"|"丙"/);
  });

  it('should resolve the audio url from the file url map', () => {
    const audioId = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    const material = Object.assign(new Question(), question, {
      type: QuestionType.MATERIAL,
      options: null,
      answer: null,
      material: '材料',
      audioFileId: audioId,
    });

    expect(toPublicQuestion(material, undefined, { [audioId.toLowerCase()]: 'https://cdn/a.mp3' })).toMatchObject({
      audioFileId: audioId,
      audioUrl: 'https://cdn/a.mp3',
      blankCount: null,
    });
    expect(toPublicQuestion(material).audioUrl).toBeNull();
  });
});
