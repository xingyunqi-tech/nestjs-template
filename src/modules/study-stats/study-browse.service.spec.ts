import { UnprocessableEntityException } from '@nestjs/common';
import { StudyBrowseService } from './study-browse.service';
import { LearningStatsService } from './learning-stats.service';
import { CheckInService } from './check-in.service';
import { KnowledgeMasteryService } from './knowledge-mastery.service';
import { UserDailyStat } from './domain/user-daily-stat';
import { CheckinReason } from './domain/study-checkin';
import { ExamProfilesService } from '../exams/exam-profiles.service';
import { KnowledgePointsService } from '../exams/knowledge-points.service';
import { SubjectsService } from '../exams/subjects.service';
import { PublicKnowledgePointTreeNodeDto } from '../exams/dto/knowledge-point-tree-node.dto';
import { UserExamProfile } from '../exams/domain/user-exam-profile';
import { KnowledgePoint } from '../exams/domain/knowledge-point';

const node = (id: string, children: PublicKnowledgePointTreeNodeDto[] = []): PublicKnowledgePointTreeNodeDto =>
  Object.assign(new PublicKnowledgePointTreeNodeDto(), { id, children, progress: null });

const daily = (date: string, subjectId: string, answered: number): UserDailyStat =>
  Object.assign(new UserDailyStat(), { date, subjectId, answered, correct: answered - 1, durationSec: answered * 10 });

describe('StudyBrowseService', () => {
  let learning: { sumDailyStats: ReturnType<typeof vi.fn>; findDailyStats: ReturnType<typeof vi.fn> };
  let checkIn: { findStreak: ReturnType<typeof vi.fn>; findMonth: ReturnType<typeof vi.fn> };
  let mastery: { findProgress: ReturnType<typeof vi.fn>; findWeakPoints: ReturnType<typeof vi.fn> };
  let profiles: { findCurrent: ReturnType<typeof vi.fn> };
  let points: { getPublishedTree: ReturnType<typeof vi.fn>; findByIds: ReturnType<typeof vi.fn> };
  let subjects: { getPublishedSubject: ReturnType<typeof vi.fn> };
  let service: StudyBrowseService;

  beforeEach(() => {
    learning = { sumDailyStats: vi.fn(), findDailyStats: vi.fn().mockResolvedValue([]) };
    checkIn = {
      findStreak: vi.fn().mockResolvedValue({ streakDays: 3, checkedInToday: true }),
      findMonth: vi.fn().mockResolvedValue([]),
    };
    mastery = { findProgress: vi.fn().mockResolvedValue(new Map()), findWeakPoints: vi.fn().mockResolvedValue([]) };
    profiles = { findCurrent: vi.fn().mockResolvedValue(null) };
    points = { getPublishedTree: vi.fn(), findByIds: vi.fn().mockResolvedValue([]) };
    subjects = { getPublishedSubject: vi.fn().mockResolvedValue({}) };
    service = new StudyBrowseService(
      learning as unknown as LearningStatsService,
      checkIn as unknown as CheckInService,
      mastery as unknown as KnowledgeMasteryService,
      profiles as unknown as ExamProfilesService,
      points as unknown as KnowledgePointsService,
      subjects as unknown as SubjectsService,
    );
  });

  describe('overview', () => {
    it('should scope progress to the current exam and count down to the exam date', async () => {
      profiles.findCurrent.mockResolvedValue(
        Object.assign(new UserExamProfile(), { examId: 'e1', isCurrent: true, dailyGoal: 30, examDate: '2026-11-29' }),
      );
      learning.sumDailyStats
        .mockResolvedValueOnce({ answered: 12, correct: 9, durationSec: 300 })
        .mockResolvedValueOnce({ answered: 420, correct: 300, durationSec: 9000 });

      const overview = await service.overview(7, new Date('2026-10-16T16:30:00Z'));

      expect(profiles.findCurrent).toHaveBeenCalledWith(7);
      expect(learning.sumDailyStats.mock.calls).toEqual([
        [7, { examId: 'e1', date: '2026-10-17' }],
        [7, { examId: 'e1' }],
      ]);
      expect(checkIn.findStreak).toHaveBeenCalledWith(7, '2026-10-17');
      expect(overview).toEqual({
        date: '2026-10-17',
        todayAnswered: 12,
        todayCorrect: 9,
        todayDurationSec: 300,
        dailyGoal: 30,
        checkedInToday: true,
        streakDays: 3,
        examId: 'e1',
        examDate: '2026-11-29',
        daysUntilExam: 43,
        totalAnswered: 420,
      });
    });

    it('should count all subjects without a current exam', async () => {
      learning.sumDailyStats.mockResolvedValue({ answered: 0, correct: 0, durationSec: 0 });

      const overview = await service.overview(7, new Date('2026-10-17T02:00:00Z'));

      expect(learning.sumDailyStats.mock.calls).toEqual([
        [7, { date: '2026-10-17' }],
        [7, {}],
      ]);
      expect(overview).toMatchObject({ dailyGoal: null, examId: null, examDate: null, daysUntilExam: null });
    });
  });

  describe('daily', () => {
    it('should return every date in the range with per subject totals', async () => {
      learning.findDailyStats.mockResolvedValue([
        daily('2026-10-15', 'a', 5),
        daily('2026-10-15', 'b', 3),
        daily('2026-10-17', 'a', 2),
      ]);

      const result = await service.daily(7, { from: '2026-10-15', to: '2026-10-17' });

      expect(learning.findDailyStats).toHaveBeenCalledWith(7, '2026-10-15', '2026-10-17');
      expect(result.map(({ date, answered, correct, durationSec }) => [date, answered, correct, durationSec])).toEqual([
        ['2026-10-15', 8, 6, 80],
        ['2026-10-16', 0, 0, 0],
        ['2026-10-17', 2, 1, 20],
      ]);
      expect(result[0].subjects.map((item) => item.subjectId)).toEqual(['a', 'b']);
    });

    it('should default to the seven days ending at the given date', async () => {
      const result = await service.daily(7, { to: '2026-10-03' });

      expect(result.map((item) => item.date)).toEqual([
        '2026-09-27',
        '2026-09-28',
        '2026-09-29',
        '2026-09-30',
        '2026-10-01',
        '2026-10-02',
        '2026-10-03',
      ]);
    });

    it('should reject reversed or overlong ranges', async () => {
      await expect(service.daily(7, { from: '2026-10-18', to: '2026-10-17' })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      await expect(service.daily(7, { from: '2025-10-16', to: '2026-10-17' })).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      await expect(service.daily(7, { from: '2025-10-17', to: '2026-10-17' })).resolves.toHaveLength(366);
    });
  });

  describe('knowledge tree', () => {
    it('should leave progress null for guests', async () => {
      points.getPublishedTree.mockResolvedValue([node('root', [node('leaf')])]);

      const tree = await service.publicKnowledgeTree('sub1');

      expect(tree[0].progress).toBeNull();
      expect(mastery.findProgress).not.toHaveBeenCalled();
    });

    it('should fill progress for every node and default to empty progress', async () => {
      points.getPublishedTree.mockResolvedValue([node('root', [node('leaf')])]);
      const leafProgress = { answeredQuestionCount: 2, questionCount: 5, answered: 6, correct: 3, mastery: 50 };
      mastery.findProgress.mockResolvedValue(new Map([['leaf', leafProgress]]));

      const tree = await service.publicKnowledgeTree('sub1', 7);

      expect(mastery.findProgress).toHaveBeenCalledWith(7, 'sub1');
      expect(tree[0].progress).toEqual({
        answeredQuestionCount: 0,
        questionCount: 0,
        answered: 0,
        correct: 0,
        mastery: null,
      });
      expect(tree[0].children[0].progress).toEqual(leafProgress);
    });
  });

  it('should attach knowledge point names to weak points', async () => {
    mastery.findWeakPoints.mockResolvedValue([{ knowledgePointId: 'kp1', answered: 8, correct: 2, mastery: 25 }]);
    points.findByIds.mockResolvedValue([
      Object.assign(new KnowledgePoint(), { id: 'kp1', name: '法律', path: '/a/kp1/' }),
    ]);

    await expect(service.weakPoints(7, 'sub1')).resolves.toEqual([
      { knowledgePointId: 'kp1', name: '法律', path: '/a/kp1/', answered: 8, correct: 2, mastery: 25 },
    ]);
    expect(subjects.getPublishedSubject).toHaveBeenCalledWith('sub1');
  });

  it('should return the month calendar with the streak', async () => {
    checkIn.findMonth.mockResolvedValue([
      { id: 'c1', userId: 7, date: '2026-09-01', reason: CheckinReason.GOAL_REACHED },
    ]);

    await expect(service.checkins(7, '2026-09')).resolves.toEqual({
      month: '2026-09',
      days: [{ date: '2026-09-01', reason: CheckinReason.GOAL_REACHED }],
      streakDays: 3,
      checkedInToday: true,
    });
  });
});
