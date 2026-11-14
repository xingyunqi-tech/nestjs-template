import type { Mocked } from 'vitest';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PracticeSessionsService } from './practice-sessions.service';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { QuestionPickerService } from './question-picker.service';
import { AnswerVisibilityService } from './answer-visibility.service';
import { MockExamService } from './mock-exam.service';
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
      | 'create'
      | 'createDaily'
      | 'findDaily'
      | 'findById'
      | 'findRecords'
      | 'closeInProgress'
      | 'updateProgress'
      | 'findOngoing'
    >
  >;
  let picker: Mocked<Pick<QuestionPickerService, 'pick' | 'pickDaily'>>;
  let visibility: Mocked<Pick<AnswerVisibilityService, 'evaluate'>>;
  let subjectsService: Mocked<Pick<SubjectsService, 'getPublishedSubject'>>;
  let knowledgePointsService: Mocked<Pick<KnowledgePointsService, 'findById'>>;
  let questionsService: Mocked<Pick<QuestionsService, 'findSummariesByIds' | 'findUnitsByQuestionIds' | 'renderUnits'>>;
  let mockExamService: Mocked<Pick<MockExamService, 'enter' | 'submit'>>;
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
      createDaily: vi.fn((_key, data) => Promise.resolve(sessionOf({ ...data }))),
      findById: vi.fn(() => Promise.resolve(session)),
      findRecords: vi.fn().mockResolvedValue([]),
      closeInProgress: vi.fn().mockResolvedValue(true),
      findOngoing: vi.fn().mockResolvedValue([]),
      updateProgress: vi.fn().mockResolvedValue(undefined),
    };
    picker = {
      pick: vi.fn().mockResolvedValue({ questionIds: ['a'], questionVersions: { a: 1 }, insufficient: true }),
      pickDaily: vi.fn().mockResolvedValue({
        questionIds: ['a'],
        questionVersions: { a: 1 },
        insufficient: false,
        dailySetQuestionIds: ['a'],
      }),
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
    mockExamService = { enter: vi.fn(), submit: vi.fn().mockResolvedValue(undefined) };
    service = new PracticeSessionsService(
      repository as unknown as PracticeSessionRepository,
      picker as unknown as QuestionPickerService,
      visibility as unknown as AnswerVisibilityService,
      subjectsService as unknown as SubjectsService,
      knowledgePointsService as unknown as KnowledgePointsService,
      questionsService as unknown as QuestionsService,
      mockExamService as unknown as MockExamService,
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

    it('should draw outside the lock and create the daily session from the expected daily set', async () => {
      picker.pickDaily.mockResolvedValue({
        questionIds: ['a'],
        questionVersions: { a: 1 },
        insufficient: false,
        dailySetQuestionIds: ['a', 'x'],
      });
      const result = await service.create(USER, dto({ mode: PracticeMode.DAILY }));
      const key = { userId: USER, subjectId: SUBJECT, dailyDate: businessDate() };
      expect(repository.findDaily).toHaveBeenCalledWith(key);
      expect(picker.pickDaily).toHaveBeenCalledWith(SUBJECT, key.dailyDate);
      expect(repository.createDaily).toHaveBeenCalledWith(
        key,
        expect.objectContaining({ mode: PracticeMode.DAILY, dailyDate: key.dailyDate, questionIds: ['a'] }),
        ['a', 'x'],
      );
      expect(picker.pickDaily.mock.invocationCallOrder[0]).toBeLessThan(
        repository.createDaily.mock.invocationCallOrder[0],
      );
      expect(result).toMatchObject({ mode: PracticeMode.DAILY, dailyDate: key.dailyDate, insufficient: false });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should draw again when the daily set changes before the session is created', async () => {
      picker.pickDaily
        .mockResolvedValueOnce({
          questionIds: ['a'],
          questionVersions: { a: 1 },
          insufficient: false,
          dailySetQuestionIds: ['a'],
        })
        .mockResolvedValueOnce({
          questionIds: ['b'],
          questionVersions: { b: 1 },
          insufficient: false,
          dailySetQuestionIds: ['b'],
        });
      repository.createDaily.mockResolvedValueOnce(null);

      const result = await service.create(USER, dto({ mode: PracticeMode.DAILY }));

      expect(picker.pickDaily).toHaveBeenCalledTimes(2);
      expect(repository.createDaily).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ questionIds: ['b'] }),
        ['b'],
      );
      expect(result.card).toEqual([expect.objectContaining({ questionId: 'b' })]);
    });

    it('should return the daily session created by another request while retrying', async () => {
      repository.createDaily.mockResolvedValueOnce(null);
      repository.findDaily
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(sessionOf({ id: 'other', mode: PracticeMode.DAILY }));

      const result = await service.create(USER, dto({ mode: PracticeMode.DAILY }));

      expect(result.id).toBe('other');
      expect(repository.createDaily).toHaveBeenCalledTimes(1);
    });

    it('should reject with a conflict when the daily set keeps changing', async () => {
      repository.createDaily.mockResolvedValue(null);

      await expect(service.create(USER, dto({ mode: PracticeMode.DAILY }))).rejects.toMatchObject({
        status: 409,
        response: { error: 'dailySetChanged' },
      });
      expect(repository.createDaily).toHaveBeenCalledTimes(3);
      expect(picker.pickDaily).toHaveBeenCalledTimes(3);
    });

    it('should return the existing daily session without drawing', async () => {
      repository.findDaily.mockResolvedValue(sessionOf({ id: 'daily', mode: PracticeMode.DAILY }));
      const result = await service.create(USER, dto({ mode: PracticeMode.DAILY }));
      expect(result.id).toBe('daily');
      expect(picker.pickDaily).not.toHaveBeenCalled();
      expect(repository.createDaily).not.toHaveBeenCalled();
    });

    it('should reject the daily session when the daily set is empty', async () => {
      picker.pickDaily.mockResolvedValue({
        questionIds: [],
        questionVersions: {},
        insufficient: false,
        dailySetQuestionIds: [],
      });
      const error = await service.create(USER, dto({ mode: PracticeMode.DAILY })).catch((caught: unknown) => caught);
      expect((error as BusinessException).errorKey).toBe('noQuestionsAvailable');
      expect(repository.createDaily).not.toHaveBeenCalled();
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
      await expect(service.create(USER, dto({ mode: PracticeMode.MOCK }))).rejects.toMatchObject({
        errorKey: 'paperRequired',
        status: 422,
      });
      expect(picker.pick).not.toHaveBeenCalled();
    });

    it('should enter a mock exam of the paper and report whether the device is active', async () => {
      mockExamService.enter.mockResolvedValue({
        session: sessionOf({ mode: PracticeMode.MOCK, paperId: 'p1' }),
        isActiveDevice: false,
      });

      const result = await service.create(USER, dto({ mode: PracticeMode.MOCK, paperId: 'p1', deviceId: 'd2' }));

      expect(mockExamService.enter).toHaveBeenCalledWith(USER, SUBJECT, 'p1', 'd2');
      expect(result).toMatchObject({ mode: PracticeMode.MOCK, insufficient: false, isActiveDevice: false });
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

  it('should submit a mock exam through the mock exam service', async () => {
    session.mode = PracticeMode.MOCK;
    await service.submit(USER, session.id);
    expect(mockExamService.submit).toHaveBeenCalledWith(session.id, true);
    expect(repository.closeInProgress).not.toHaveBeenCalled();
  });

  it('should not finish or abandon daily practice', async () => {
    session.mode = PracticeMode.DAILY;
    await expect(service.submit(USER, session.id)).rejects.toMatchObject({
      errorKey: 'dailySessionCannotFinish',
      status: 409,
    });
    await expect(service.abandon(USER, session.id)).rejects.toMatchObject({
      errorKey: 'dailySessionCannotAbandon',
      status: 409,
    });
    expect(repository.closeInProgress).not.toHaveBeenCalled();
  });

  it('should list ongoing sessions excluding the given modes', async () => {
    repository.findOngoing.mockResolvedValue([session]);

    await expect(service.findOngoing(USER)).resolves.toMatchObject([{ id: session.id }]);
    expect(repository.findOngoing).toHaveBeenLastCalledWith(USER, 20, []);

    await service.findOngoing(USER, [PracticeMode.DAILY]);
    expect(repository.findOngoing).toHaveBeenLastCalledWith(USER, 20, [PracticeMode.DAILY]);
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
    expect(visibility.evaluate).toHaveBeenCalledWith(USER, expect.any(Array), 'session');
  });
});
