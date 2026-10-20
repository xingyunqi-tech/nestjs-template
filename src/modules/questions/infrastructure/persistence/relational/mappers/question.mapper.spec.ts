import { QuestionMapper } from './question.mapper';
import { QuestionEntity } from '../entities/question.entity';
import { CreateQuestionData } from '../../question.repository';
import { QuestionType } from '../../../../domain/question-type';
import { QuestionStatus } from '../../../../domain/question-status';
import { QuestionSource } from '../../../../domain/question-source';

const createData = (overrides: Partial<CreateQuestionData> = {}): CreateQuestionData => ({
  subjectId: 's1',
  parentId: null,
  type: QuestionType.SINGLE,
  stem: '题干',
  options: null,
  answer: null,
  analysis: null,
  difficulty: 3,
  material: null,
  audioFileId: null,
  source: QuestionSource.ORIGINAL,
  sourceNote: null,
  status: QuestionStatus.DRAFT,
  isFree: true,
  sort: 0,
  contentHash: 'hash',
  createdBy: 7,
  ...overrides,
});

describe('QuestionMapper', () => {
  it('should map audit fields to the domain', () => {
    const submittedAt = new Date('2026-10-01T08:00:00Z');
    const reviewedAt = new Date('2026-10-02T08:00:00Z');
    const entity = Object.assign(new QuestionEntity(), QuestionMapper.toPersistence(createData()), {
      id: 'q1',
      currentVersion: 0,
      statAnswered: 0,
      statCorrect: 0,
      submittedBy: 8,
      submittedAt,
      reviewedBy: 9,
      reviewedAt,
      rejectReason: '答案有误',
    });

    expect(QuestionMapper.toDomain(entity, [])).toMatchObject({
      createdBy: 7,
      submittedBy: 8,
      submittedAt,
      reviewedBy: 9,
      reviewedAt,
      rejectReason: '答案有误',
    });
  });

  it('should persist the creator of a new question', () => {
    expect(QuestionMapper.toPersistence(createData()).createdBy).toBe(7);
    expect(QuestionMapper.toPersistence(createData({ createdBy: null })).createdBy).toBeNull();
  });
});
