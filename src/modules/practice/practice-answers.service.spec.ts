import type { Mocked } from 'vitest';
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { PracticeAnswersService } from './practice-answers.service';
import {
  InsertAnswerRecordData,
  MockSubmission,
  PracticeSessionRepository,
  PracticeTransaction,
  SessionCounterDelta,
} from './infrastructure/persistence/practice-session.repository';
import { AnswerVisibilityService } from './answer-visibility.service';
import { StatsEventPublisher } from './ports/stats-event.publisher';
import { PracticeMode } from './domain/practice-mode';
import { PracticeSession, PracticeSessionStatus } from './domain/practice-session';
import { AnswerRecord, GradingStatus, SelfAssessment } from './domain/answer-record';
import { SaveAnswersDto } from './dto/save-answers.dto';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { FilesService } from '../files/files.service';
import { BusinessException } from '../../common/exceptions/business.exception';

const USER = 5;
const IMAGE = '0f8fad5b-d9cb-469f-a165-70867728950e';

const question = (id: string, overrides: Partial<Question>): Question =>
  Object.assign(new Question(), { id, parentId: null, currentVersion: 1, analysis: '解析', ...overrides });

const OPTIONS = ['A', 'B', 'C'].map((key) => ({ key, content: key }));

const QUESTIONS = [
  question('single', { type: QuestionType.SINGLE, options: OPTIONS, answer: { keys: ['B'] } }),
  question('multi', { type: QuestionType.MULTIPLE, options: OPTIONS, answer: { keys: ['A', 'C'] } }),
  question('short', { type: QuestionType.SHORT_ANSWER, answer: { reference: '参考', points: ['要点'] } }),
];

function errorKey(error: unknown): string | undefined {
  return error instanceof BusinessException ? error.errorKey : undefined;
}

class FakeTransaction implements PracticeTransaction {
  readonly records = new Map<string, AnswerRecord>();
  readonly deltas: SessionCounterDelta[] = [];
  mockQuestionIds: string[] = [];
  private sequence = 0;

  constructor(public session: PracticeSession) {}

  lockSessionForWrite(): Promise<PracticeSession> {
    return Promise.resolve(this.session);
  }

  findInProgressMockQuestionIds(_userId: number, questionIds: string[]): Promise<string[]> {
    return Promise.resolve(questionIds.filter((id) => this.mockQuestionIds.includes(id)));
  }

  findRecordsForUpdate(_sessionId: string, questionIds: string[]): Promise<AnswerRecord[]> {
    return Promise.resolve(questionIds.flatMap((id) => this.records.get(id) ?? []));
  }

  insertRecord(data: InsertAnswerRecordData): Promise<AnswerRecord | null> {
    if (this.records.has(data.questionId)) {
      return Promise.resolve(null);
    }
    this.sequence += 1;
    const record = Object.assign(new AnswerRecord(), {
      selfAssessment: null,
      gradingStatus: null,
      ...data,
      id: `r${this.sequence}`,
    });
    this.records.set(data.questionId, record);
    return Promise.resolve(record);
  }

  updateRecord(id: string, changes: Partial<AnswerRecord>): Promise<AnswerRecord> {
    const record = [...this.records.values()].find((item) => item.id === id)!;
    Object.assign(record, changes);
    return Promise.resolve({ ...record });
  }

  adjustSessionCounters(_id: string, delta: SessionCounterDelta): Promise<void> {
    this.deltas.push(delta);
    return Promise.resolve();
  }

  readonly markFirstAttempt = vi.fn((_session: Pick<PracticeSession, 'id'>) => Promise.resolve(true));

  setActiveDevice(): Promise<void> {
    return Promise.resolve();
  }

  gradeRecords(): Promise<void> {
    return Promise.resolve();
  }

  closeMock(_id: string, _submission: MockSubmission): Promise<boolean> {
    return Promise.resolve(true);
  }

  totals(): SessionCounterDelta {
    return this.deltas.reduce(
      (sum, delta) => ({
        answered: sum.answered + delta.answered,
        correct: sum.correct + delta.correct,
        durationSec: sum.durationSec + delta.durationSec,
      }),
      { answered: 0, correct: 0, durationSec: 0 },
    );
  }
}

describe('PracticeAnswersService', () => {
  let session: PracticeSession;
  let tx: FakeTransaction;
  let repository: Mocked<Pick<PracticeSessionRepository, 'findById' | 'transaction'>>;
  let questionsService: Mocked<Pick<QuestionsService, 'findByIds' | 'findUnitsByQuestionIds' | 'renderUnits'>>;
  let filesService: Mocked<Pick<FilesService, 'findByIds'>>;
  let visibility: Mocked<Pick<AnswerVisibilityService, 'evaluate'>>;
  let publisher: Mocked<StatsEventPublisher>;
  let service: PracticeAnswersService;

  const save = (answers: SaveAnswersDto['answers']) => service.save(USER, session.id, { deviceId: 'd1', answers });

  const patch = (questionId: string, answer?: unknown, extra: object = {}) => ({
    questionId,
    answer,
    clientSeq: 1,
    clientAnsweredAt: new Date(),
    ...extra,
  });

  beforeEach(() => {
    session = Object.assign(new PracticeSession(), {
      id: 'session-1',
      userId: USER,
      mode: PracticeMode.CHAPTER,
      status: PracticeSessionStatus.IN_PROGRESS,
      questionIds: QUESTIONS.map((item) => item.id),
      questionVersions: { single: 1, multi: 1, short: 1 },
    });
    tx = new FakeTransaction(session);
    repository = {
      findById: vi.fn(() => Promise.resolve(session)),
      transaction: vi.fn((work) => work(tx)) as never,
    };
    questionsService = {
      findByIds: vi.fn((ids: string[]) => Promise.resolve(QUESTIONS.filter((item) => ids.includes(item.id)))),
      findUnitsByQuestionIds: vi.fn().mockResolvedValue([]),
      renderUnits: vi.fn((_units, _viewer, options: { solutionIds?: ReadonlySet<string> }) =>
        Promise.resolve({
          units: [],
          solutions: new Map([...(options.solutionIds ?? [])].map((id) => [id, { answer: { id }, analysis: '解析' }])),
        }),
      ) as never,
    };
    filesService = { findByIds: vi.fn().mockResolvedValue([]) };
    visibility = {
      evaluate: vi.fn((_userId, items: { record?: Pick<AnswerRecord, 'answer'> | null }[]) =>
        Promise.resolve(
          items.map((item) => ({ visible: !!item.record && item.record.answer !== null, hiddenReason: null })),
        ),
      ),
    };
    publisher = { publishRecord: vi.fn().mockResolvedValue(undefined), publishSession: vi.fn() };
    service = new PracticeAnswersService(
      repository as unknown as PracticeSessionRepository,
      questionsService as unknown as QuestionsService,
      filesService as unknown as FilesService,
      visibility as unknown as AnswerVisibilityService,
      publisher,
    );
  });

  it('should grade objective questions on first submit and lock the result', async () => {
    const first = await save([patch('single', { keys: ['A'] }, { durationSec: 900 })]);
    expect(first.results[0]).toMatchObject({
      questionId: 'single',
      answerState: { answer: { keys: ['A'] }, isCorrect: false, durationSec: 600 },
      solution: { analysis: '解析' },
    });
    expect(visibility.evaluate).toHaveBeenCalledWith(USER, expect.any(Array), 'session');
    const record = tx.records.get('single')!;
    expect(record.gradedAt).toBeInstanceOf(Date);
    expect(record.statDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(record).not.toHaveProperty('statsAppliedAt');
    expect(publisher.publishRecord).toHaveBeenCalledWith(record.id);

    const second = await save([patch('single', { keys: ['B'] })]);
    expect(second.results[0].answerState).toMatchObject({ answer: { keys: ['A'] }, isCorrect: false });
    expect(tx.totals()).toEqual({ answered: 1, correct: 0, durationSec: 600 });
    expect(publisher.publishRecord).toHaveBeenCalledTimes(1);
  });

  it('should judge multiple choice by all-or-nothing outside mock exams', async () => {
    const { results } = await save([patch('multi', { keys: ['A'] })]);
    expect(results[0].answerState).toMatchObject({ isCorrect: false, isPartial: false, score: null });
  });

  it('should lock subjective answers without grading and return the reference answer', async () => {
    const { results } = await save([patch('short', { text: '我的答案' })]);
    expect(results[0]).toMatchObject({
      answerState: { answer: { text: '我的答案' }, isCorrect: null },
      solution: { answer: { id: 'short' } },
    });
    expect(tx.records.get('short')!.gradedAt).toBeNull();
    expect(publisher.publishRecord).not.toHaveBeenCalled();

    await save([patch('short', { text: '改答案' })]);
    expect(tx.records.get('short')!.answer).toEqual({ text: '我的答案' });
    expect(tx.totals().answered).toBe(1);
  });

  it('should save a mark without counting it as answered and keep it when answering later', async () => {
    const { results } = await save([patch('single', undefined, { markedForReview: true })]);
    expect(results[0].answerState).toMatchObject({ answer: null, markedForReview: true, isCorrect: null });
    expect(results[0].solution).toBeNull();
    expect(tx.totals().answered).toBe(0);

    await save([patch('single', { keys: ['B'] })]);
    expect(tx.records.get('single')).toMatchObject({ answer: { keys: ['B'] }, isCorrect: true, markedForReview: true });
    expect(tx.totals()).toEqual({ answered: 1, correct: 1, durationSec: 0 });

    await save([patch('single', null, { markedForReview: false })]);
    expect(tx.records.get('single')).toMatchObject({ answer: { keys: ['B'] }, markedForReview: false });
  });

  it('should ignore empty answers without a mark', async () => {
    const { results } = await save([patch('single', { keys: [] })]);
    expect(results[0].answerState).toBeNull();
    expect(tx.records.size).toBe(0);
  });

  it('should reject writes to questions in an ongoing mock without revealing results', async () => {
    tx.mockQuestionIds = ['single'];
    const error = await save([patch('single', { keys: ['B'] })]).catch((caught: unknown) => caught);
    expect(errorKey(error)).toBe('questionInMockInProgress');
    expect(tx.records.size).toBe(0);
  });

  it('should reject writes to closed sessions', async () => {
    tx.session = { ...session, status: PracticeSessionStatus.SUBMITTED };
    expect(errorKey(await save([patch('single', { keys: ['B'] })]).catch((caught: unknown) => caught))).toBe(
      'sessionClosed',
    );
  });

  it('should validate the request before writing', async () => {
    await expect(save([patch('other', { keys: ['B'] })])).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(save([patch('single', { keys: ['B'] }), patch('single', null)])).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(save([patch('single', { value: true })])).resolves.toBeDefined();
    await expect(save([patch('multi', { keys: 'A' })])).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(save([patch('short', { imageFileIds: [IMAGE] })])).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    session.mode = PracticeMode.MEMORIZE;
    await expect(save([patch('single', { keys: ['B'] })])).rejects.toBeInstanceOf(UnprocessableEntityException);
    session.userId = 99;
    await expect(save([patch('single', { keys: ['B'] })])).rejects.toBeInstanceOf(NotFoundException);
  });

  it('should reject answers that do not match the question', async () => {
    await expect(save([patch('single', { keys: ['D'] })])).rejects.toMatchObject({
      response: { errors: { answers: 'answerNotMatchQuestion' } },
    });
    await expect(save([patch('single', { keys: ['A', 'B'] })])).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(tx.records.size).toBe(0);
  });

  it('should refresh the answer time only when the answer is written', async () => {
    await save([patch('single', undefined, { markedForReview: true })]);
    const marked = tx.records.get('single')!.answeredAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await save([patch('single', { keys: ['B'] })]);
    const answered = tx.records.get('single')!.answeredAt;
    expect(answered.getTime()).toBeGreaterThan(marked.getTime());
    await save([patch('single', null, { markedForReview: false })]);
    expect(tx.records.get('single')!.answeredAt).toBe(answered);
  });

  it('should accept images uploaded by the user', async () => {
    filesService.findByIds.mockResolvedValue([{ id: IMAGE, ownerUserId: USER } as never]);
    await save([patch('short', { imageFileIds: [IMAGE] })]);
    expect(tx.records.get('short')!.answer).toEqual({ imageFileIds: [IMAGE] });
  });

  describe('selfAssess', () => {
    const assess = (selfAssessment: SelfAssessment) =>
      service.selfAssess(USER, session.id, { questionId: 'short', selfAssessment });

    it('should grade a submitted subjective answer and lock the assessment', async () => {
      await save([patch('short', { text: '答' })]);
      const result = await assess(SelfAssessment.UNKNOWN);
      expect(result.answerState).toMatchObject({ selfAssessment: SelfAssessment.UNKNOWN, isCorrect: false });
      const record = tx.records.get('short')!;
      expect(record.gradedAt).toBeInstanceOf(Date);
      expect(publisher.publishRecord).toHaveBeenCalledWith(record.id);

      const again = await assess(SelfAssessment.KNOWN);
      expect(again.answerState).toMatchObject({ selfAssessment: SelfAssessment.UNKNOWN, isCorrect: false });
      expect(publisher.publishRecord).toHaveBeenCalledTimes(1);
    });

    it('should count known as correct', async () => {
      await save([patch('short', { text: '答' })]);
      await assess(SelfAssessment.KNOWN);
      expect(tx.totals()).toEqual({ answered: 1, correct: 1, durationSec: 0 });
    });

    it('should allow assessing after the practice is finished but not after abandoning', async () => {
      await save([patch('short', { text: '答' })]);
      session.status = PracticeSessionStatus.SUBMITTED;
      tx.session = session;
      await expect(assess(SelfAssessment.KNOWN)).resolves.toBeDefined();

      session.status = PracticeSessionStatus.ABANDONED;
      expect(errorKey(await assess(SelfAssessment.KNOWN).catch((caught: unknown) => caught))).toBe(
        'selfAssessmentNotAllowed',
      );
    });

    it('should reject assessing an ongoing mock, an unanswered question or a pending grading', async () => {
      session.mode = PracticeMode.MOCK;
      expect(errorKey(await assess(SelfAssessment.KNOWN).catch((caught: unknown) => caught))).toBe(
        'selfAssessmentNotAllowed',
      );

      session.mode = PracticeMode.CHAPTER;
      expect(errorKey(await assess(SelfAssessment.KNOWN).catch((caught: unknown) => caught))).toBe(
        'selfAssessmentNotAllowed',
      );

      await save([patch('short', { text: '答' })]);
      tx.records.get('short')!.gradingStatus = GradingStatus.PENDING;
      expect(errorKey(await assess(SelfAssessment.KNOWN).catch((caught: unknown) => caught))).toBe(
        'selfAssessmentNotAllowed',
      );
    });

    it('should only accept subjective questions', async () => {
      await expect(
        service.selfAssess(USER, session.id, { questionId: 'single', selfAssessment: SelfAssessment.KNOWN }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('should reject assessing questions in an ongoing mock', async () => {
      await save([patch('short', { text: '答' })]);
      tx.mockQuestionIds = ['short'];
      expect(errorKey(await assess(SelfAssessment.KNOWN).catch((caught: unknown) => caught))).toBe(
        'questionInMockInProgress',
      );
    });
  });
  describe('mock exam', () => {
    const MINUTE = 60_000;
    const saveFrom = (deviceId: string, answers: SaveAnswersDto['answers'], offline?: boolean) =>
      service.save(USER, session.id, { deviceId, offline, answers });
    const failure = (promise: Promise<unknown>) => promise.catch((caught: unknown) => errorKey(caught));

    beforeEach(() => {
      Object.assign(session, {
        mode: PracticeMode.MOCK,
        paperId: 'p1',
        activeDeviceId: 'd1',
        isFirstAttempt: false,
        deadlineAt: new Date(Date.now() + 30 * MINUTE),
        autoSubmitAt: new Date(Date.now() + 35 * MINUTE),
      });
    });

    it('should save answers without grading, allow overwriting and mark the first attempt', async () => {
      const first = await save([patch('single', { keys: ['A'] }, { clientSeq: 1 })]);
      expect(first.results[0]).toMatchObject({ answerState: { answer: { keys: ['A'] }, isCorrect: null } });
      expect(tx.records.get('single')).toMatchObject({ isCorrect: null, score: null, gradedAt: null });

      await save([patch('single', { keys: ['B'] }, { clientSeq: 2 })]);
      expect(tx.records.get('single')).toMatchObject({ answer: { keys: ['B'] }, clientSeq: 2 });
      expect(tx.totals()).toEqual({ answered: 1, correct: 0, durationSec: 0 });
      expect(tx.markFirstAttempt).toHaveBeenCalledTimes(1);
      expect(publisher.publishRecord).not.toHaveBeenCalled();
    });

    it('should ignore stale writes of the same device and keep a soft cleared record', async () => {
      await save([patch('single', { keys: ['A'] }, { clientSeq: 5 })]);
      await save([patch('single', null, { clientSeq: 6 })]);
      await save([patch('single', { keys: ['A'] }, { clientSeq: 5 })]);

      expect(tx.records.get('single')).toMatchObject({ answer: null, clientSeq: 6 });
      expect(tx.totals().answered).toBe(0);
    });

    it('should keep the answer when only the mark changes', async () => {
      await save([patch('single', { keys: ['A'] }, { clientSeq: 1 })]);
      await save([{ questionId: 'single', markedForReview: true, clientSeq: 2, clientAnsweredAt: new Date() }]);

      expect(tx.records.get('single')).toMatchObject({ answer: { keys: ['A'] }, markedForReview: true });
      expect(tx.totals().answered).toBe(1);
    });

    it('should let the active device overwrite records of the previous device', async () => {
      await save([patch('single', { keys: ['A'] }, { clientSeq: 10 })]);
      session.activeDeviceId = 'd2';

      await saveFrom('d2', [patch('single', { keys: ['C'] }, { clientSeq: 1 })]);

      expect(tx.records.get('single')).toMatchObject({ answer: { keys: ['C'] }, deviceId: 'd2', clientSeq: 1 });
      expect(await failure(save([patch('single', { keys: ['B'] }, { clientSeq: 11 })]))).toBe('sessionTakenOver');
    });

    it('should accept only offline answers made before the deadline during the sync window', async () => {
      const deadline = new Date(Date.now() - MINUTE);
      Object.assign(session, { deadlineAt: deadline, autoSubmitAt: new Date(Date.now() + 4 * MINUTE) });

      expect(await failure(save([patch('single', { keys: ['A'] })]))).toBe('sessionClosed');
      const result = await saveFrom(
        'd1',
        [
          patch('single', { keys: ['A'] }, { clientAnsweredAt: new Date(deadline.getTime() - 1000) }),
          patch('multi', { keys: ['A'] }, { clientAnsweredAt: new Date(deadline.getTime() + 1000) }),
        ],
        true,
      );

      expect(result.skippedQuestionIds).toEqual(['multi']);
      expect(tx.records.get('single')?.answer).toEqual({ keys: ['A'] });
      expect(tx.records.has('multi')).toBe(false);
    });

    it('should reject writes after the auto submit time', async () => {
      Object.assign(session, {
        deadlineAt: new Date(Date.now() - 6 * MINUTE),
        autoSubmitAt: new Date(Date.now() - MINUTE),
      });
      expect(await failure(saveFrom('d1', [patch('single', { keys: ['A'] })], true))).toBe('sessionClosed');
    });

    it('should not mark the first attempt for clears, marks or an already marked session', async () => {
      await save([{ questionId: 'single', markedForReview: true, clientSeq: 1, clientAnsweredAt: new Date() }]);
      expect(tx.markFirstAttempt).not.toHaveBeenCalled();

      session.isFirstAttempt = true;
      await save([patch('multi', { keys: ['A'] }, { clientSeq: 2 })]);
      expect(tx.markFirstAttempt).not.toHaveBeenCalled();
    });
  });
});
