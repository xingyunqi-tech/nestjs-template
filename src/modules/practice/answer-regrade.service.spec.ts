import type { Mocked } from 'vitest';
import { AnswerRegradeService, ErrataTarget } from './answer-regrade.service';
import { AnswerRegradeRepository, RegradeRecord } from './infrastructure/persistence/answer-regrade.repository';
import { PracticeMode } from './domain/practice-mode';
import { QuestionType } from '../questions/domain/question-type';
import { MultiScoringRule } from '../papers/domain/multi-scoring-rule';
import { TransactionHandle } from '../../common/database/transaction-handle';

const HANDLE = Object.freeze({}) as TransactionHandle;
const SINGLE: ErrataTarget = { questionId: 'q1', toVersion: 3, type: QuestionType.SINGLE };

const record = (id: string, overrides: Partial<RegradeRecord> = {}): RegradeRecord => ({
  id,
  sessionId: 's1',
  answer: { keys: ['B'] },
  isCorrect: false,
  isPartial: false,
  score: null,
  gradedAt: new Date('2026-10-10T02:00:00Z'),
  statDate: '2026-10-10',
  statsAppliedAt: new Date('2026-10-10T02:00:01Z'),
  firstForQuestion: false,
  mode: PracticeMode.RANDOM,
  subjectId: 'sub1',
  paperScore: null,
  multiScoringRule: null,
  ...overrides,
});

describe('AnswerRegradeService', () => {
  let repository: Mocked<AnswerRegradeRepository>;
  let service: AnswerRegradeService;

  beforeEach(() => {
    repository = {
      raiseInProgressSessionVersions: vi.fn(),
      countPendingUsers: vi.fn(),
      findPendingUsers: vi.fn(),
      lockPendingRecords: vi.fn().mockResolvedValue([]),
      writeRegrades: vi.fn().mockResolvedValue(undefined),
      adjustSessionScores: vi.fn().mockResolvedValue(undefined),
    };
    service = new AnswerRegradeService(repository);
  });

  it('should regrade a wrong answer as correct and add one correct to its session', async () => {
    repository.lockPendingRecords.mockResolvedValue([record('r1', { firstForQuestion: true })]);

    const changed = await service.regradeUser(HANDLE, 7, SINGLE, { keys: ['B'] });

    expect(repository.lockPendingRecords).toHaveBeenCalledWith(HANDLE, 7, {
      questionId: 'q1',
      toVersion: 3,
      objective: true,
    });
    expect(repository.writeRegrades).toHaveBeenCalledWith(
      HANDLE,
      ['r1'],
      [{ id: 'r1', isCorrect: true, isPartial: false, score: null }],
      3,
    );
    expect(repository.adjustSessionScores).toHaveBeenCalledWith(HANDLE, [
      { sessionId: 's1', correct: 1, scoreCents: 0 },
    ]);
    expect(changed).toEqual([{ statDate: '2026-10-10', subjectId: 'sub1', firstForQuestion: true, isCorrect: true }]);
  });

  it('should regrade a correct answer as wrong and subtract one correct from its session', async () => {
    repository.lockPendingRecords.mockResolvedValue([record('r1', { isCorrect: true })]);

    const changed = await service.regradeUser(HANDLE, 7, SINGLE, { keys: ['C'] });

    expect(repository.adjustSessionScores).toHaveBeenCalledWith(HANDLE, [
      { sessionId: 's1', correct: -1, scoreCents: 0 },
    ]);
    expect(changed).toEqual([expect.objectContaining({ isCorrect: false })]);
  });

  it('should recompute mock scores with the paper score and multiple scoring rule', async () => {
    repository.lockPendingRecords.mockResolvedValue([
      record('r1', {
        mode: PracticeMode.MOCK,
        answer: { keys: ['A'] },
        isCorrect: false,
        score: 0,
        paperScore: 3,
        multiScoringRule: MultiScoringRule.PARTIAL,
      }),
    ]);

    await service.regradeUser(
      HANDLE,
      7,
      { questionId: 'q1', toVersion: 2, type: QuestionType.MULTIPLE },
      { keys: ['A', 'C'] },
    );

    expect(repository.writeRegrades).toHaveBeenCalledWith(
      HANDLE,
      ['r1'],
      [{ id: 'r1', isCorrect: false, isPartial: true, score: 1.5 }],
      2,
    );
    expect(repository.adjustSessionScores).toHaveBeenCalledWith(HANDLE, [
      { sessionId: 's1', correct: 0, scoreCents: 150 },
    ]);
  });

  it('should only raise the version of records whose result does not change', async () => {
    repository.lockPendingRecords.mockResolvedValue([record('r1', { isCorrect: true })]);

    const changed = await service.regradeUser(HANDLE, 7, SINGLE, { keys: ['B'] });

    expect(repository.writeRegrades).toHaveBeenCalledWith(HANDLE, ['r1'], [], 3);
    expect(repository.adjustSessionScores).toHaveBeenCalledWith(HANDLE, []);
    expect(changed).toEqual([]);
  });

  it('should not report stats changes for records not yet applied to stats', async () => {
    repository.lockPendingRecords.mockResolvedValue([record('r1', { statsAppliedAt: null })]);

    const changed = await service.regradeUser(HANDLE, 7, SINGLE, { keys: ['B'] });

    expect(repository.writeRegrades).toHaveBeenCalledWith(HANDLE, ['r1'], [expect.objectContaining({ id: 'r1' })], 3);
    expect(changed).toEqual([]);
  });

  it('should only raise the version of subjective records', async () => {
    repository.lockPendingRecords.mockResolvedValue([record('r1', { isCorrect: false, answer: { text: '答' } })]);

    const changed = await service.regradeUser(
      HANDLE,
      7,
      { questionId: 'q1', toVersion: 2, type: QuestionType.SHORT_ANSWER },
      { reference: '参考', points: [] },
    );

    expect(repository.lockPendingRecords).toHaveBeenCalledWith(HANDLE, 7, {
      questionId: 'q1',
      toVersion: 2,
      objective: false,
    });
    expect(repository.writeRegrades).toHaveBeenCalledWith(HANDLE, ['r1'], [], 2);
    expect(changed).toEqual([]);
  });

  it('should take the stat date from the grading time when the record has none', async () => {
    repository.lockPendingRecords.mockResolvedValue([
      record('r1', { statDate: null, gradedAt: new Date('2026-10-10T17:00:00Z') }),
    ]);

    const [changed] = await service.regradeUser(HANDLE, 7, SINGLE, { keys: ['B'] });

    expect(changed.statDate).toBe('2026-10-11');
  });
});
