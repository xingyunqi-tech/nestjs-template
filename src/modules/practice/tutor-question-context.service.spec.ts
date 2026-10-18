import type { Mock } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { TutorQuestionContextService } from './tutor-question-context.service';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { AnswerVisibilityService } from './answer-visibility.service';
import { PracticeMode } from './domain/practice-mode';
import { PracticeSession, PracticeSessionStatus } from './domain/practice-session';
import { QuestionsService } from '../questions/questions.service';
import { QuestionType } from '../questions/domain/question-type';
import { BusinessException } from '../../common/exceptions/business.exception';

const QUESTION_ID = '11111111-1111-4111-8111-111111111111';
const MATERIAL_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

describe('TutorQuestionContextService', () => {
  const question = { id: QUESTION_ID, type: QuestionType.SINGLE, parentId: null };
  const session = Object.assign(new PracticeSession(), {
    id: SESSION_ID,
    userId: 7,
    mode: PracticeMode.CHAPTER,
    status: PracticeSessionStatus.IN_PROGRESS,
    questionIds: [QUESTION_ID],
  });
  let repository: Record<string, ReturnType<typeof vi.fn>>;
  let visibility: { assertVisible: ReturnType<typeof vi.fn> };
  let questions: { findByIds: Mock<(ids: string[]) => Promise<unknown[]>> };
  let service: TutorQuestionContextService;

  beforeEach(() => {
    repository = {
      findById: vi.fn().mockResolvedValue(session),
      findRecords: vi.fn().mockResolvedValue([{ answer: { keys: ['A'] }, isCorrect: false }]),
      findSessionAnswerContexts: vi.fn().mockResolvedValue([]),
    };
    visibility = { assertVisible: vi.fn().mockResolvedValue(undefined) };
    questions = { findByIds: vi.fn<(ids: string[]) => Promise<unknown[]>>().mockResolvedValue([question]) };
    service = new TutorQuestionContextService(
      repository as unknown as PracticeSessionRepository,
      visibility as unknown as AnswerVisibilityService,
      questions as unknown as QuestionsService,
    );
  });

  it('should judge visibility by the session and use its answer when a session is given', async () => {
    await expect(service.resolve(7, QUESTION_ID, SESSION_ID)).resolves.toEqual({
      question,
      material: null,
      record: { answer: { keys: ['A'] }, isCorrect: false },
    });
    expect(visibility.assertVisible).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ questionId: QUESTION_ID, session }),
      'session',
    );
  });

  it('should reject a question that is not in the session', async () => {
    repository.findById.mockResolvedValue({ ...session, questionIds: [] });

    await expect(service.resolve(7, QUESTION_ID, SESSION_ID)).rejects.toMatchObject({
      errorKey: 'questionNotAccessible',
    });
    expect(visibility.assertVisible).not.toHaveBeenCalled();
  });

  it("should hide another user's session", async () => {
    repository.findById.mockResolvedValue({ ...session, userId: 8 });

    await expect(service.resolve(7, QUESTION_ID, SESSION_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should propagate answerHidden from the visibility check', async () => {
    visibility.assertVisible.mockRejectedValue(new BusinessException('answerHidden'));

    await expect(service.resolve(7, QUESTION_ID, SESSION_ID)).rejects.toMatchObject({ errorKey: 'answerHidden' });
  });

  it('should judge visibility outside sessions and use the latest revealed answer without a session', async () => {
    repository.findSessionAnswerContexts.mockResolvedValue([
      {
        session: { mode: PracticeMode.MOCK, status: PracticeSessionStatus.ABANDONED },
        record: { answer: { keys: ['C'] }, isCorrect: null },
      },
      {
        session: { mode: PracticeMode.CHAPTER, status: PracticeSessionStatus.SUBMITTED },
        record: { answer: { keys: ['B'] }, isCorrect: true },
      },
    ]);

    await expect(service.resolve(7, QUESTION_ID, null)).resolves.toMatchObject({
      record: { answer: { keys: ['B'] }, isCorrect: true },
    });
    expect(visibility.assertVisible).toHaveBeenCalledWith(
      7,
      { questionId: QUESTION_ID, questionType: QuestionType.SINGLE },
      'standalone',
    );
  });

  it('should attach the material of a sub-question and reject the material itself', async () => {
    const material = { id: MATERIAL_ID, type: QuestionType.MATERIAL, parentId: null };
    questions.findByIds.mockImplementation((ids: string[]) =>
      Promise.resolve(ids[0] === MATERIAL_ID ? [material] : [{ ...question, parentId: MATERIAL_ID }]),
    );

    await expect(service.resolve(7, QUESTION_ID, null)).resolves.toMatchObject({ material });
    await expect(service.resolve(7, MATERIAL_ID, null)).rejects.toMatchObject({ errorKey: 'questionNotAccessible' });
  });
});
