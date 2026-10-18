import type { Mocked } from 'vitest';
import { AnswerVisibilityService, VisibilityItem } from './answer-visibility.service';
import { InProgressMockQuestionsService } from './in-progress-mock-questions.service';
import { QuestionAssociationReader } from './ports/question-association.reader';
import { PracticeMode } from './domain/practice-mode';
import { PracticeSessionStatus } from './domain/practice-session';
import { HiddenReason } from './domain/hidden-reason';
import { QuestionType } from '../questions/domain/question-type';
import { BusinessException } from '../../common/exceptions/business.exception';

const USER = 7;
const session = (mode: PracticeMode, status = PracticeSessionStatus.IN_PROGRESS) => ({ mode, status });
const graded = { answer: { keys: ['A'] }, isCorrect: false };
const VISIBLE = { visible: true, hiddenReason: null };
const HIDDEN = { visible: false, hiddenReason: null };
const MOCK_HIDDEN = { visible: false, hiddenReason: HiddenReason.MOCK_IN_PROGRESS };

describe('AnswerVisibilityService', () => {
  let mockQuestions: Mocked<Pick<InProgressMockQuestionsService, 'findQuestionIds'>>;
  let associations: Mocked<QuestionAssociationReader>;
  let service: AnswerVisibilityService;

  const item = (overrides: Partial<VisibilityItem>): VisibilityItem => ({
    questionId: 'q1',
    questionType: QuestionType.SINGLE,
    ...overrides,
  });

  beforeEach(() => {
    mockQuestions = { findQuestionIds: vi.fn().mockResolvedValue(new Set()) };
    associations = { findAssociatedQuestionIds: vi.fn().mockResolvedValue([]) };
    service = new AnswerVisibilityService(mockQuestions as unknown as InProgressMockQuestionsService, associations);
  });

  it('should show memorize answers directly', async () => {
    expect(await service.check(USER, item({ session: session(PracticeMode.MEMORIZE) }))).toEqual(VISIBLE);
  });

  it('should show objective answers in immediate modes only after grading', async () => {
    const chapter = session(PracticeMode.CHAPTER);
    expect(await service.check(USER, item({ session: chapter, record: graded }))).toEqual(VISIBLE);
    expect(await service.check(USER, item({ session: chapter, record: null }))).toEqual(HIDDEN);
    expect(await service.check(USER, item({ session: chapter, record: { answer: null, isCorrect: null } }))).toEqual(
      HIDDEN,
    );
  });

  it('should show subjective reference answers once the answer is submitted', async () => {
    const daily = session(PracticeMode.DAILY);
    const subjective = { questionType: QuestionType.SHORT_ANSWER, session: daily };
    expect(
      await service.check(USER, item({ ...subjective, record: { answer: { text: 't' }, isCorrect: null } })),
    ).toEqual(VISIBLE);
    expect(await service.check(USER, item({ ...subjective, record: { answer: null, isCorrect: null } }))).toEqual(
      HIDDEN,
    );
  });

  it('should show mock answers only after submission', async () => {
    expect(await service.check(USER, item({ session: session(PracticeMode.MOCK), record: graded }))).toEqual(HIDDEN);
    expect(
      await service.check(USER, item({ session: session(PracticeMode.MOCK, PracticeSessionStatus.SUBMITTED) })),
    ).toEqual(VISIBLE);
  });

  it('should show answers of questions in the wrong book, favorites or notes', async () => {
    associations.findAssociatedQuestionIds.mockResolvedValue(['q2']);
    const results = await service.evaluate(USER, [item({ questionId: 'q1' }), item({ questionId: 'q2' })]);
    expect(results).toEqual([HIDDEN, VISIBLE]);
    expect(associations.findAssociatedQuestionIds).toHaveBeenCalledWith(USER, ['q1', 'q2']);
  });

  it('should hide everything for questions in an ongoing mock, including wrong book questions', async () => {
    mockQuestions.findQuestionIds.mockResolvedValue(new Set(['q1']));
    associations.findAssociatedQuestionIds.mockResolvedValue(['q1']);
    expect(await service.check(USER, item({ session: session(PracticeMode.MEMORIZE) }))).toEqual(MOCK_HIDDEN);
    expect(await service.check(USER, item({ session: session(PracticeMode.CHAPTER), record: graded }))).toEqual(
      MOCK_HIDDEN,
    );
    expect(await service.check(USER, item({}))).toEqual(MOCK_HIDDEN);
    expect(associations.findAssociatedQuestionIds).not.toHaveBeenCalled();
  });

  it('should skip the association lookup when rules 1-3 already apply', async () => {
    await service.evaluate(USER, [item({ session: session(PracticeMode.MEMORIZE) })]);
    expect(associations.findAssociatedQuestionIds).not.toHaveBeenCalled();
    expect(await service.evaluate(USER, [])).toEqual([]);
  });

  it('should throw answerHidden with the hidden reason', async () => {
    mockQuestions.findQuestionIds.mockResolvedValue(new Set(['q1']));
    const error = await service.assertVisible(USER, item({})).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BusinessException);
    expect((error as BusinessException).errorKey).toBe('answerHidden');
    expect((error as BusinessException).getResponse()).toMatchObject({
      errors: { hiddenReason: HiddenReason.MOCK_IN_PROGRESS },
    });
    await expect(
      service.assertVisible(USER, item({ session: session(PracticeMode.MEMORIZE), questionId: 'q2' })),
    ).resolves.toBeUndefined();
  });
});
