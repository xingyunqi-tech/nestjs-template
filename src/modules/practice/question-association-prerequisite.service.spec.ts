import type { Mocked } from 'vitest';
import { QuestionAssociationPrerequisiteService } from './question-association-prerequisite.service';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { InProgressMockQuestionsService } from './in-progress-mock-questions.service';
import { PracticeMode } from './domain/practice-mode';
import { PracticeSessionStatus } from './domain/practice-session';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';

const USER = 7;
const QUESTION_ID = '11111111-1111-4111-8111-111111111111';

const question = (overrides: Partial<Question> = {}): Question =>
  Object.assign(new Question(), { id: QUESTION_ID, type: QuestionType.SINGLE, isFree: true, ...overrides });

const context = (mode: PracticeMode, status: PracticeSessionStatus, record: Question['answer'] | null = null) => ({
  session: { mode, status },
  record: { answer: record as Record<string, unknown> | null, isCorrect: record ? true : null },
});

describe('QuestionAssociationPrerequisiteService', () => {
  let repository: Mocked<Pick<PracticeSessionRepository, 'findSessionAnswerContexts'>>;
  let mockQuestions: Mocked<Pick<InProgressMockQuestionsService, 'findQuestionIds'>>;
  let questions: Mocked<Pick<QuestionsService, 'findByIds'>>;
  let service: QuestionAssociationPrerequisiteService;

  beforeEach(() => {
    repository = { findSessionAnswerContexts: vi.fn().mockResolvedValue([]) };
    mockQuestions = { findQuestionIds: vi.fn().mockResolvedValue(new Set()) };
    questions = { findByIds: vi.fn().mockResolvedValue([question()]) };
    service = new QuestionAssociationPrerequisiteService(
      repository as unknown as PracticeSessionRepository,
      mockQuestions as unknown as InProgressMockQuestionsService,
      questions as unknown as QuestionsService,
    );
  });

  const expectRejected = () =>
    expect(service.assertEligible(USER, QUESTION_ID)).rejects.toMatchObject({ errorKey: 'questionNotAccessible' });

  it('should accept a question graded in an immediate session', async () => {
    repository.findSessionAnswerContexts.mockResolvedValue([
      context(PracticeMode.CHAPTER, PracticeSessionStatus.IN_PROGRESS, { keys: ['A'] }),
    ]);
    await expect(service.assertEligible(USER, QUESTION_ID.toUpperCase())).resolves.toMatchObject({ id: QUESTION_ID });
    expect(questions.findByIds).toHaveBeenCalledWith([QUESTION_ID]);
  });

  it('should accept memorize sessions and submitted mocks', async () => {
    repository.findSessionAnswerContexts.mockResolvedValue([
      context(PracticeMode.MEMORIZE, PracticeSessionStatus.ABANDONED),
    ]);
    await expect(service.assertEligible(USER, QUESTION_ID)).resolves.toBeDefined();
    repository.findSessionAnswerContexts.mockResolvedValue([
      context(PracticeMode.MOCK, PracticeSessionStatus.SUBMITTED),
    ]);
    await expect(service.assertEligible(USER, QUESTION_ID)).resolves.toBeDefined();
  });

  it('should reject questions only in abandoned mocks or never answered', async () => {
    repository.findSessionAnswerContexts.mockResolvedValue([
      context(PracticeMode.MOCK, PracticeSessionStatus.ABANDONED, { keys: ['A'] }),
      context(PracticeMode.RANDOM, PracticeSessionStatus.IN_PROGRESS),
    ]);
    await expectRejected();
  });

  it('should reject questions in an ongoing mock even if answered elsewhere', async () => {
    repository.findSessionAnswerContexts.mockResolvedValue([
      context(PracticeMode.CHAPTER, PracticeSessionStatus.SUBMITTED, { keys: ['A'] }),
    ]);
    mockQuestions.findQuestionIds.mockResolvedValue(new Set([QUESTION_ID]));
    await expectRejected();
  });

  it('should accept paid questions answered in a session', async () => {
    questions.findByIds.mockResolvedValue([question({ isFree: false })]);
    repository.findSessionAnswerContexts.mockResolvedValue([
      context(PracticeMode.MEMORIZE, PracticeSessionStatus.SUBMITTED),
    ]);
    await expect(service.assertEligible(USER, QUESTION_ID)).resolves.toMatchObject({ isFree: false });
  });

  it('should reject missing and material questions and invalid ids', async () => {
    questions.findByIds.mockResolvedValue([]);
    await expectRejected();
    questions.findByIds.mockResolvedValue([question({ type: QuestionType.MATERIAL })]);
    await expectRejected();
    await expect(service.assertEligible(USER, 'not-a-uuid')).rejects.toMatchObject({
      errorKey: 'questionNotAccessible',
    });
    expect(repository.findSessionAnswerContexts).not.toHaveBeenCalled();
  });
});
