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

    expect(dto).toMatchObject({ id: 'q1', version: 2, stem: '当前题干', knowledgePointIds: ['k1'] });
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
});
