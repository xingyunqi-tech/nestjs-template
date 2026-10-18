import type { Mocked } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import { MockExamService } from './mock-exam.service';
import {
  MockPaperMissingError,
  MockSubmission,
  PracticeSessionRepository,
  PracticeTransaction,
  RecordGrade,
} from './infrastructure/persistence/practice-session.repository';
import { QuestionPickerService } from './question-picker.service';
import { MockSubmitScheduler } from './mock-submit.scheduler';
import { StatsEventPublisher } from './ports/stats-event.publisher';
import { PracticeMode } from './domain/practice-mode';
import { PracticeSession, PracticeSessionStatus, ScoringScheme, SubmitType } from './domain/practice-session';
import { AnswerRecord } from './domain/answer-record';
import { PapersService } from '../papers/papers.service';
import { Paper } from '../papers/domain/paper';
import { PaperType } from '../papers/domain/paper-type';
import { PaperQuestion } from '../papers/domain/paper-question';
import { MultiScoringRule } from '../papers/domain/multi-scoring-rule';
import { ContentStatus } from '../exams/domain/content-status';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { AppConfigService } from '../config/config.service';

const USER = 7;
const MINUTE = 60_000;

const paperOf = (overrides: Partial<Paper> = {}): Paper =>
  Object.assign(new Paper(), {
    id: 'p1',
    subjectId: 's1',
    type: PaperType.MOCK,
    ownerUserId: null,
    durationMin: 60,
    objectiveScore: 6,
    multiScoringRule: MultiScoringRule.PARTIAL,
    status: ContentStatus.PUBLISHED,
    ...overrides,
  });

const sessionOf = (overrides: Partial<PracticeSession> = {}): PracticeSession =>
  Object.assign(new PracticeSession(), {
    id: 'session-1',
    userId: USER,
    subjectId: 's1',
    mode: PracticeMode.MOCK,
    paperId: 'p1',
    status: PracticeSessionStatus.IN_PROGRESS,
    questionIds: ['single', 'multi', 'short'],
    activeDeviceId: 'd1',
    startedAt: new Date(Date.now() - 10 * MINUTE),
    deadlineAt: new Date(Date.now() + 50 * MINUTE),
    autoSubmitAt: new Date(Date.now() + 55 * MINUTE),
    answeredCount: 3,
    correctCount: 0,
    ...overrides,
  });

const record = (questionId: string, answer: Record<string, unknown> | null): AnswerRecord =>
  Object.assign(new AnswerRecord(), { id: `r-${questionId}`, questionId, answer });

const OPTIONS = ['A', 'B', 'C'].map((key) => ({ key, content: key }));

const QUESTIONS = [
  Object.assign(new Question(), { id: 'single', type: QuestionType.SINGLE, options: OPTIONS, answer: { keys: ['B'] } }),
  Object.assign(new Question(), {
    id: 'multi',
    type: QuestionType.MULTIPLE,
    options: OPTIONS,
    answer: { keys: ['A', 'C'] },
  }),
  Object.assign(new Question(), {
    id: 'short',
    type: QuestionType.SHORT_ANSWER,
    answer: { reference: 'r', points: [] },
  }),
];

describe('MockExamService', () => {
  let session: PracticeSession;
  let closed: MockSubmission[];
  let graded: RecordGrade[];
  let repository: Mocked<
    Pick<PracticeSessionRepository, 'findInProgressMock' | 'insertMockIfAbsent' | 'findById' | 'transaction'>
  >;
  let papersService: Mocked<Pick<PapersService, 'findById' | 'findQuestions'>>;
  let picker: Mocked<Pick<QuestionPickerService, 'pickFromPaper'>>;
  let scheduler: Mocked<Pick<MockSubmitScheduler, 'schedule'>>;
  let publisher: Mocked<StatsEventPublisher>;
  let service: MockExamService;
  let setActiveDevice: Mocked<PracticeTransaction>['setActiveDevice'];

  beforeEach(() => {
    session = sessionOf();
    closed = [];
    graded = [];
    setActiveDevice = vi.fn((_id: string, deviceId: string) => {
      session.activeDeviceId = deviceId;
      return Promise.resolve();
    });
    const tx: Partial<PracticeTransaction> = {
      lockSessionForWrite: vi.fn(() => Promise.resolve(session)),
      setActiveDevice,
      findRecordsForUpdate: vi
        .fn()
        .mockResolvedValue([
          record('single', { keys: ['B'] }),
          record('multi', { keys: ['A'] }),
          record('short', { text: '答' }),
        ]),
      gradeRecords: vi.fn((grades: RecordGrade[]) => {
        graded.push(...grades);
        return Promise.resolve();
      }),
      closeMock: vi.fn((_id: string, submission: MockSubmission) => {
        closed.push(submission);
        session.status = submission.status;
        return Promise.resolve(true);
      }),
    };
    repository = {
      findInProgressMock: vi.fn().mockResolvedValue(null),
      insertMockIfAbsent: vi.fn((data) => Promise.resolve(sessionOf({ ...data, id: 'new' }))),
      findById: vi.fn(() => Promise.resolve(session)),
      transaction: vi.fn((work) => work(tx as PracticeTransaction)) as never,
    };
    papersService = {
      findById: vi.fn().mockResolvedValue(paperOf()),
      findQuestions: vi.fn().mockResolvedValue(
        [
          ['single', 2],
          ['multi', 4],
          ['short', 10],
        ].map(([questionId, score]) => Object.assign(new PaperQuestion(), { questionId, score })),
      ),
    };
    picker = {
      pickFromPaper: vi.fn().mockResolvedValue({
        questionIds: ['single', 'multi', 'short'],
        questionVersions: { single: 1, multi: 1, short: 2 },
        insufficient: false,
      }),
    };
    scheduler = { schedule: vi.fn().mockResolvedValue(undefined) };
    publisher = { publishRecord: vi.fn(), publishSession: vi.fn().mockResolvedValue(undefined) };
    service = new MockExamService(
      repository as unknown as PracticeSessionRepository,
      picker as unknown as QuestionPickerService,
      papersService as unknown as PapersService,
      {
        findByIds: vi.fn((ids: string[]) => Promise.resolve(QUESTIONS.filter((item) => ids.includes(item.id)))),
      } as unknown as QuestionsService,
      { getValue: vi.fn().mockResolvedValue(5) } as unknown as AppConfigService,
      scheduler as unknown as MockSubmitScheduler,
      publisher,
    );
  });

  describe('enter', () => {
    it('should create a timed session with paper versions and schedule the auto submit', async () => {
      const entry = await service.enter(USER, 's1', 'p1', 'd1');

      const data = repository.insertMockIfAbsent.mock.calls[0][0];
      expect(data).toMatchObject({
        mode: PracticeMode.MOCK,
        paperId: 'p1',
        activeDeviceId: 'd1',
        questionVersions: { single: 1, multi: 1, short: 2 },
        scoringScheme: ScoringScheme.OBJECTIVE_ONLY,
        totalScore: 6,
      });
      expect(data.deadlineAt!.getTime() - data.startedAt.getTime()).toBe(60 * MINUTE);
      expect(data.autoSubmitAt!.getTime() - data.deadlineAt!.getTime()).toBe(5 * MINUTE);
      expect(scheduler.schedule).toHaveBeenCalledWith('new', data.autoSubmitAt);
      expect(entry.isActiveDevice).toBe(true);
    });

    it('should return the ongoing session when the insert conflicts', async () => {
      repository.insertMockIfAbsent.mockResolvedValue(null);
      repository.findInProgressMock.mockResolvedValueOnce(null).mockResolvedValueOnce(session);

      const entry = await service.enter(USER, 's1', 'p1', 'd1');

      expect(entry).toEqual({ session, isActiveDevice: true });
      expect(scheduler.schedule).not.toHaveBeenCalled();
    });

    it('should take over with a new device only before the deadline', async () => {
      repository.findInProgressMock.mockResolvedValue(session);
      const entry = await service.enter(USER, 's1', 'p1', 'd2');
      expect(setActiveDevice).toHaveBeenCalledWith(session.id, 'd2');
      expect(entry.isActiveDevice).toBe(true);

      setActiveDevice.mockClear();
      session.deadlineAt = new Date(Date.now() - MINUTE);
      const late = await service.enter(USER, 's1', 'p1', 'd3');
      expect(setActiveDevice).not.toHaveBeenCalled();
      expect(late.isActiveDevice).toBe(false);
    });

    it('should submit an overdue session and return it without creating a new one', async () => {
      session.autoSubmitAt = new Date(Date.now() - MINUTE);
      repository.findInProgressMock.mockResolvedValue(session);

      const entry = await service.enter(USER, 's1', 'p1', 'd1');

      expect(closed[0]).toMatchObject({ status: PracticeSessionStatus.SUBMITTED, submitType: SubmitType.AUTO_TIMEOUT });
      expect(entry).toMatchObject({ session: { id: session.id, status: PracticeSessionStatus.SUBMITTED } });
      expect(entry.isActiveDevice).toBe(false);
      expect(repository.insertMockIfAbsent).not.toHaveBeenCalled();
    });

    it('should reject as busy when the session keeps changing state', async () => {
      repository.insertMockIfAbsent.mockResolvedValue(null);

      await expect(service.enter(USER, 's1', 'p1', 'd1')).rejects.toMatchObject({
        errorKey: 'mockSessionBusy',
        status: 409,
      });
      expect(repository.insertMockIfAbsent).toHaveBeenCalledTimes(3);
    });

    it('should report a paper removed while creating as not found', async () => {
      repository.insertMockIfAbsent.mockRejectedValue(new MockPaperMissingError());
      await expect(service.enter(USER, 's1', 'p1', 'd1')).rejects.toMatchObject({
        response: { errors: { paperId: 'paperNotFound' } },
      });
    });

    it('should reject papers of other subjects, other owners or not published', async () => {
      await expect(service.enter(USER, 'other', 'p1', 'd1')).rejects.toBeInstanceOf(UnprocessableEntityException);
      papersService.findById.mockResolvedValue(paperOf({ type: PaperType.GENERATED, ownerUserId: 99 }));
      await expect(service.enter(USER, 's1', 'p1', 'd1')).rejects.toBeInstanceOf(UnprocessableEntityException);
      papersService.findById.mockResolvedValue(paperOf({ status: ContentStatus.OFFLINE }));
      await expect(service.enter(USER, 's1', 'p1', 'd1')).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('submit', () => {
    it('should grade objective answers with paper scores and publish the session', async () => {
      await service.submit(session.id, true);

      expect(graded).toEqual([
        { id: 'r-single', isCorrect: true, isPartial: false, score: 2 },
        { id: 'r-multi', isCorrect: false, isPartial: true, score: 2 },
      ]);
      expect(closed).toEqual([
        expect.objectContaining({
          status: PracticeSessionStatus.SUBMITTED,
          submitType: SubmitType.MANUAL,
          score: 4,
          correctCount: 1,
          scoringScheme: ScoringScheme.OBJECTIVE_ONLY,
          totalScore: 6,
          durationSec: expect.any(Number),
        }),
      ]);
      expect(publisher.publishSession).toHaveBeenCalledWith(session.id);
    });

    it('should do nothing for finished sessions or auto submits before the time', async () => {
      await expect(service.autoSubmit(session.id)).resolves.toEqual(session.autoSubmitAt);
      session.status = PracticeSessionStatus.SUBMITTED;
      await expect(service.submit(session.id, true)).resolves.toBeNull();

      expect(closed).toEqual([]);
      expect(publisher.publishSession).not.toHaveBeenCalled();
    });

    it('should abandon a timed out session without answers', async () => {
      Object.assign(session, { answeredCount: 0, autoSubmitAt: new Date(Date.now() - MINUTE) });

      await service.autoSubmit(session.id);

      expect(closed).toEqual([{ status: PracticeSessionStatus.ABANDONED }]);
      expect(graded).toEqual([]);
      expect(publisher.publishSession).not.toHaveBeenCalled();
    });

    it('should record a manual submission after the auto submit time as a timeout', async () => {
      session.autoSubmitAt = new Date(Date.now() - MINUTE);
      await service.submit(session.id, true);
      expect(closed[0]).toMatchObject({ status: PracticeSessionStatus.SUBMITTED, submitType: SubmitType.AUTO_TIMEOUT });
    });
  });
});
