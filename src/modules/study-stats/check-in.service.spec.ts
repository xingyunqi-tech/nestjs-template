import type { Mocked } from 'vitest';
import { CheckInService } from './check-in.service';
import { CheckInRepository } from './infrastructure/persistence/check-in.repository';
import { CheckinReason } from './domain/study-checkin';
import { StatsRecord } from './domain/stats-record';
import { PracticeMode } from '../practice/domain/practice-mode';
import { QuestionType } from '../questions/domain/question-type';
import { TransactionHandle } from '../../common/database/transaction-handle';

const record = (overrides: Partial<StatsRecord> = {}): StatsRecord => ({
  id: 'r1',
  sessionId: 's1',
  userId: 7,
  subjectId: 'sub1',
  mode: PracticeMode.RANDOM,
  questionId: 'q1',
  questionType: QuestionType.SINGLE,
  questionSubjectId: 'sub1',
  knowledgePointIds: [],
  answer: null,
  isCorrect: true,
  isPartial: false,
  selfAssessment: null,
  durationSec: 0,
  gradedAt: new Date('2026-10-17T02:00:00Z'),
  statDate: '2026-10-16',
  firstForQuestion: false,
  ...overrides,
});

describe('CheckInService', () => {
  const handle = {} as TransactionHandle;
  let repository: Mocked<CheckInRepository>;
  let service: CheckInService;

  beforeEach(() => {
    repository = {
      lockUserDate: vi.fn().mockResolvedValue(undefined),
      hasCheckin: vi.fn().mockResolvedValue(false),
      isDailySessionDone: vi.fn().mockResolvedValue(false),
      findGoalProgress: vi.fn().mockResolvedValue(null),
      insert: vi.fn().mockResolvedValue(true),
      findByDateRange: vi.fn().mockResolvedValue([]),
      findStreak: vi.fn().mockResolvedValue({ streakDays: 0, checkedInToday: false }),
    };
    service = new CheckInService(repository);
  });

  it('should check in on the stat date when the daily practice of that day is done', async () => {
    repository.isDailySessionDone.mockResolvedValue(true);

    await service.apply(handle, record());

    expect(repository.lockUserDate).toHaveBeenCalledWith(handle, 7, '2026-10-16');
    expect(repository.lockUserDate.mock.invocationCallOrder[0]).toBeLessThan(
      repository.hasCheckin.mock.invocationCallOrder[0],
    );
    expect(repository.isDailySessionDone).toHaveBeenCalledWith(handle, 7, '2026-10-16');
    expect(repository.insert).toHaveBeenCalledWith(handle, 7, '2026-10-16', CheckinReason.DAILY_DONE);
    expect(repository.findGoalProgress).not.toHaveBeenCalled();
  });

  it('should check in when the answers of the current exam reach the daily goal', async () => {
    repository.findGoalProgress.mockResolvedValue({ dailyGoal: 30, answered: 30 });

    await service.apply(handle, record());

    expect(repository.insert).toHaveBeenCalledWith(handle, 7, '2026-10-16', CheckinReason.GOAL_REACHED);
  });

  it('should not check in below the daily goal or without a current exam', async () => {
    repository.findGoalProgress.mockResolvedValueOnce({ dailyGoal: 30, answered: 29 }).mockResolvedValueOnce(null);

    await service.apply(handle, record());
    await service.apply(handle, record());

    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('should skip evaluation when the stat date is already checked in', async () => {
    repository.hasCheckin.mockResolvedValue(true);

    await service.apply(handle, record());

    expect(repository.isDailySessionDone).not.toHaveBeenCalled();
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it('should evaluate a given user and date without a record', async () => {
    repository.isDailySessionDone.mockResolvedValue(true);

    await service.evaluate(handle, 7, '2026-10-17');

    expect(repository.lockUserDate).toHaveBeenCalledWith(handle, 7, '2026-10-17');
    expect(repository.insert).toHaveBeenCalledWith(handle, 7, '2026-10-17', CheckinReason.DAILY_DONE);
  });

  it('should read the streak from the repository', async () => {
    repository.findStreak.mockResolvedValue({ streakDays: 2, checkedInToday: false });

    await expect(service.findStreak(7, '2026-10-17')).resolves.toEqual({ streakDays: 2, checkedInToday: false });
    expect(repository.findStreak).toHaveBeenCalledWith(7, '2026-10-17');
  });

  it('should query the whole month for the calendar', async () => {
    await service.findMonth(7, '2026-02');

    expect(repository.findByDateRange).toHaveBeenCalledWith(7, '2026-02-01', '2026-02-28');
  });
});
