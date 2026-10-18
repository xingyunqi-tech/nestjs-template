import type { Mocked } from 'vitest';
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PracticeSessionsService } from './practice-sessions.service';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { QuestionPickerService } from './question-picker.service';
import { AnswerVisibilityService } from './answer-visibility.service';
import { PracticeMode } from './domain/practice-mode';
import { PracticeSession, PracticeSessionStatus, SubmitType } from './domain/practice-session';
import { CreatePracticeSessionDto } from './dto/create-practice-session.dto';
import { SubjectsService } from '../exams/subjects.service';
import { KnowledgePointsService } from '../exams/knowledge-points.service';
import { KnowledgePoint } from '../exams/domain/knowledge-point';
import { QuestionsService } from '../questions/questions.service';
import { QuestionType } from '../questions/domain/question-type';
import { businessDate } from '../papers/domain/business-date';
import { BusinessException } from '../../common/exceptions/business.exception';

const USER = 3;
const SUBJECT = 's1';

const sessionOf = (overrides: Partial<PracticeSession> = {}): PracticeSession =>
  Object.assign(new PracticeSession(), {
    id: 'session-1',
    userId: USER,
    subjectId: SUBJECT,
    mode: PracticeMode.CHAPTER,
    status: PracticeSessionStatus.IN_PROGRESS,
    scope: {},
    questionIds: ['a', 'm1', 'm2', 'b'],
    questionVersions: { a: 1, m1: 1, m2: 1, b: 1 },
    ...overrides,
  });

describe('PracticeSessionsService', () => {
  let session: PracticeSession;
  let repository: Mocked<
    Pick<
      PracticeSessionRepository,
      'create' | 'createDaily' | 'findDaily' | 'findById' | 'findRecords' | 'closeInProgress' | 'updateProgress'
    >
  >;
  let picker: Mocked<Pick<QuestionPickerService, 'pick'>>;
  let visibility: Mocked<Pick<AnswerVisibilityService, 'evaluate'>>;
  let subjectsService: Mocked<Pick<SubjectsService, 'getPublishedSubject'>>;
  let knowledgePointsService: Mocked<Pick<KnowledgePointsService, 'findById'>>;
  let questionsService: Mocked<Pick<QuestionsService, 'findSummariesByIds' | 'findUnitsByQuestionIds' | 'renderUnits'>>;
  let service: PracticeSessionsService;

  const dto = (overrides: Partial<CreatePracticeSessionDto>): CreatePracticeSessionDto =>
    Object.assign(new CreatePracticeSessionDto(), {
      subjectId: SUBJECT,
      deviceId: 'd1',
      mode: PracticeMode.RANDOM,
      ...overrides,
    });

  beforeEach(() => {
    session = sessionOf();
    repository = {
      create: vi.fn((data) => Promise.resolve(sessionOf({ ...data }))),
      findDaily: vi.fn().mockResolvedValue(null),
      createDaily: vi.fn(async (_key, build: () => Promise<object | null>) => {
        const data = await build();
        return data && sessionOf({ ...data });
      }) as never,
      findById: vi.fn(() => Promise.resolve(session)),
      findRecords: vi.fn().mockResolvedValue([]),
      closeInProgress: vi.fn().mockResolvedValue(true),
      updateProgress: vi.fn().mockResolvedValue(undefined),
    };
    picker = {
      pick: vi.fn().mockResolvedValue({ questionIds: ['a'], questionVersions: { a: 1 }, insufficient: true }),
    };
    visibility = {
      evaluate: vi.fn((_userId, items: unknown[]) =>
        Promise.resolve(items.map(() => ({ visible: false, hiddenReason: null }))),
      ),
    };
    subjectsService = { getPublishedSubject: vi.fn().mockResolvedValue({}) };
    knowledgePointsService = {
      findById: vi.fn().mockResolvedValue(Object.assign(new KnowledgePoint(), { subjectId: SUBJECT })),
    };
    questionsService = {
      findSummariesByIds: vi.fn((ids: string[]) =>
        Promise.resolve(
          ids.map((id) => ({ id, parentId: id.startsWith('m') ? 'm' : null, type: QuestionType.SINGLE, stem: '' })),
        ),
      ),
      findUnitsByQuestionIds: vi.fn().mockResolvedValue([]),
      renderUnits: vi.fn().mockResolvedValue({ units: [], solutions: new Map() }),
    };
    service = new PracticeSessionsService(
      repository as unknown as PracticeSessionRepository,
      picker as unknown as QuestionPickerService,
      visibility as unknown as AnswerVisibilityService,
      subjectsService as unknown as SubjectsService,
      knowledgePointsService as unknown as KnowledgePointsService,
      questionsService as unknown as QuestionsService,
    );
  });

  describe('create', () => {
    it('should create a session from the picked questions and report insufficient', async () => {
      const result = await service.create(USER, dto({ count: 5 }));
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER,
          mode: PracticeMode.RANDOM,
          questionIds: ['a'],
          dailyDate: null,
          activeDeviceId: null,
        }),
      );
      expect(result).toMatchObject({
        questionCount: 1,
        insufficient: true,
        card: [expect.objectContaining({ questionId: 'a' })],
      });
      expect(result.serverNow).toBeInstanceOf(Date);
    });

    it('should create the daily session from the daily set under the lock', async () => {
      const result = await service.create(USER, dto({ mode: PracticeMode.DAILY }));
      const key = { userId: USER, subjectId: SUBJECT, dailyDate: businessDate() };
      expect(repository.findDaily).toHaveBeenCalledWith(key);
      expect(repository.createDaily).toHaveBeenCalledWith(key, expect.any(Function));
      expect(picker.pick).toHaveBeenCalledWith(
        expect.objectContaining({ mode: PracticeMode.DAILY, dailyDate: key.dailyDate }),
      );
      expect(result).toMatchObject({ mode: PracticeMode.DAILY, dailyDate: key.dailyDate, insufficient: false });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should return the existing daily session without drawing', async () => {
      repository.findDaily.mockResolvedValue(sessionOf({ id: 'daily', mode: PracticeMode.DAILY }));
      const result = await service.create(USER, dto({ mode: PracticeMode.DAILY }));
      expect(result.id).toBe('daily');
      expect(picker.pick).not.toHaveBeenCalled();
      expect(repository.createDaily).not.toHaveBeenCalled();
    });

    it('should reject the daily session when the daily set is empty', async () => {
      picker.pick.mockResolvedValue({ questionIds: [], questionVersions: {}, insufficient: false });
      const error = await service.create(USER, dto({ mode: PracticeMode.DAILY })).catch((caught: unknown) => caught);
      expect((error as BusinessException).errorKey).toBe('noQuestionsAvailable');
    });

    it('should reject when no question can be drawn', async () => {
      picker.pick.mockResolvedValue({ questionIds: [], questionVersions: {}, insufficient: true });
      const error = await service.create(USER, dto({})).catch((caught: unknown) => caught);
      expect((error as BusinessException).errorKey).toBe('noQuestionsAvailable');
    });

    it('should validate the scope of each mode', async () => {
      await expect(service.create(USER, dto({ mode: PracticeMode.CHAPTER }))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      await expect(service.create(USER, dto({ mode: PracticeMode.TYPE }))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      await expect(service.create(USER, dto({ mode: PracticeMode.MEMORIZE }))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      await expect(service.create(USER, dto({ mode: PracticeMode.MEMORIZE, paperId: 'p' }))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      knowledgePointsService.findById.mockResolvedValue(Object.assign(new KnowledgePoint(), { subjectId: 'other' }));
      await expect(
        service.create(USER, dto({ mode: PracticeMode.CHAPTER, scope: { knowledgePointId: 'kp' } })),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      await expect(service.create(USER, dto({ mode: PracticeMode.MOCK }))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(picker.pick).not.toHaveBeenCalled();
    });

    it('should keep only the scope fields of the mode', async () => {
      await service.create(
        USER,
        dto({ mode: PracticeMode.CHAPTER, scope: { knowledgePointId: 'kp', questionType: QuestionType.JUDGE } }),
      );
      expect(picker.pick).toHaveBeenCalledWith(expect.objectContaining({ scope: { knowledgePointId: 'kp' } }));
    });

    it('should reject unpublished subjects', async () => {
      subjectsService.getPublishedSubject.mockRejectedValue(new NotFoundException());
      await expect(service.create(USER, dto({}))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  it('should align segments to material boundaries', async () => {
    const result = await service.getQuestions(USER, session.id, { from: 2, size: 1 });
    expect(questionsService.findUnitsByQuestionIds).toHaveBeenCalledWith(['m1', 'm2']);
    expect(result).toMatchObject({ from: 1, total: 4 });
  });

  it('should hide sessions of other users', async () => {
    session.userId = 99;
    await expect(service.getDetail(USER, session.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should finish practice by a conditional update', async () => {
    await service.submit(USER, session.id);
    expect(repository.closeInProgress).toHaveBeenCalledWith(
      session.id,
      PracticeSessionStatus.SUBMITTED,
      SubmitType.MANUAL,
    );
  });

  it('should not finish or abandon daily practice', async () => {
    session.mode = PracticeMode.DAILY;
    await expect(service.submit(USER, session.id)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.abandon(USER, session.id)).rejects.toBeInstanceOf(ConflictException);
    expect(repository.closeInProgress).not.toHaveBeenCalled();
  });

  it('should abandon a session by a conditional update', async () => {
    session.mode = PracticeMode.MOCK;
    await service.abandon(USER, session.id);
    expect(repository.closeInProgress).toHaveBeenCalledWith(session.id, PracticeSessionStatus.ABANDONED, null);
  });

  it('should reject a progress beyond the questions', async () => {
    await expect(service.updateProgress(USER, session.id, 4)).rejects.toBeInstanceOf(UnprocessableEntityException);
    await service.updateProgress(USER, session.id, 3);
    expect(repository.updateProgress).toHaveBeenCalledWith(session.id, 3);
  });

  it('should hide grading results on the answer card when answers are hidden', async () => {
    repository.findRecords.mockResolvedValue([
      { questionId: 'a', answer: { keys: ['A'] }, isCorrect: false, isPartial: false, markedForReview: true } as never,
    ]);
    const detail = await service.getDetail(USER, session.id);
    expect(detail.card[0]).toMatchObject({ questionId: 'a', answered: true, isCorrect: null, markedForReview: true });
    expect(detail.card[1]).toMatchObject({ questionId: 'm1', materialId: 'm', answered: false });
  });
});
