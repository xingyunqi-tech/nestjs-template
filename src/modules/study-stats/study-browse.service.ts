import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { LearningStatsService } from './learning-stats.service';
import { CheckInService } from './check-in.service';
import { KnowledgeMasteryService } from './knowledge-mastery.service';
import { KnowledgePointProgress } from './domain/knowledge-point-progress';
import { addDays, datesBetween } from './domain/calendar';
import { StudyOverviewDto } from './dto/study-overview.dto';
import { DailyStatDto } from './dto/daily-stat.dto';
import { WeakPointDto } from './dto/weak-point.dto';
import { CheckinCalendarDto } from './dto/checkin-calendar.dto';
import { QueryDailyStatsDto } from './dto/query-study.dto';
import { ExamProfilesService } from '../exams/exam-profiles.service';
import { KnowledgePointsService } from '../exams/knowledge-points.service';
import { SubjectsService } from '../exams/subjects.service';
import { PublicKnowledgePointTreeNodeDto } from '../exams/dto/knowledge-point-tree-node.dto';
import { businessDate, daysBetween } from '../papers/domain/business-date';

const DEFAULT_DAILY_RANGE_DAYS = 7;
const MAX_DAILY_RANGE_DAYS = 366;

const EMPTY_PROGRESS: KnowledgePointProgress = {
  answeredQuestionCount: 0,
  questionCount: 0,
  answered: 0,
  correct: 0,
  mastery: null,
};

function withProgress(
  nodes: PublicKnowledgePointTreeNodeDto[],
  progress: Map<string, KnowledgePointProgress>,
): PublicKnowledgePointTreeNodeDto[] {
  for (const node of nodes) {
    node.progress = { ...(progress.get(node.id) ?? EMPTY_PROGRESS) };
    withProgress(node.children, progress);
  }
  return nodes;
}

@Injectable()
export class StudyBrowseService {
  constructor(
    private readonly learningStatsService: LearningStatsService,
    private readonly checkInService: CheckInService,
    private readonly knowledgeMasteryService: KnowledgeMasteryService,
    private readonly examProfilesService: ExamProfilesService,
    private readonly knowledgePointsService: KnowledgePointsService,
    private readonly subjectsService: SubjectsService,
  ) {}

  async overview(userId: number, now: Date = new Date()): Promise<StudyOverviewDto> {
    const today = businessDate(now);
    const current = await this.examProfilesService.findCurrent(userId);
    const scope = current ? { examId: current.examId } : {};
    const [todayTotals, totals, streak] = await Promise.all([
      this.learningStatsService.sumDailyStats(userId, { ...scope, date: today }),
      this.learningStatsService.sumDailyStats(userId, scope),
      this.checkInService.findStreak(userId, today),
    ]);
    return {
      date: today,
      todayAnswered: todayTotals.answered,
      todayCorrect: todayTotals.correct,
      todayDurationSec: todayTotals.durationSec,
      dailyGoal: current?.dailyGoal ?? null,
      checkedInToday: streak.checkedInToday,
      streakDays: streak.streakDays,
      examId: current?.examId ?? null,
      examDate: current?.examDate ?? null,
      daysUntilExam: current?.examDate ? daysBetween(today, current.examDate) : null,
      totalAnswered: totals.answered,
    };
  }

  /** 区间内每一天的统计，无作答的日期为 0 */
  async daily(userId: number, query: QueryDailyStatsDto): Promise<DailyStatDto[]> {
    const to = query.to ?? businessDate();
    const from = query.from ?? addDays(to, 1 - DEFAULT_DAILY_RANGE_DAYS);
    if (from > to || daysBetween(from, to) >= MAX_DAILY_RANGE_DAYS) {
      throw new UnprocessableEntityException({ errors: { from: 'invalidDateRange' } });
    }
    const stats = await this.learningStatsService.findDailyStats(userId, from, to);
    return datesBetween(from, to).map((date) => {
      const subjects = stats
        .filter((stat) => stat.date === date)
        .map(({ subjectId, answered, correct, durationSec }) => ({ subjectId, answered, correct, durationSec }));
      return {
        date,
        answered: subjects.reduce((sum, item) => sum + item.answered, 0),
        correct: subjects.reduce((sum, item) => sum + item.correct, 0),
        durationSec: subjects.reduce((sum, item) => sum + item.durationSec, 0),
        subjects,
      };
    });
  }

  async knowledgeTree(userId: number, subjectId: string): Promise<PublicKnowledgePointTreeNodeDto[]> {
    const tree = await this.knowledgePointsService.getPublishedTree(subjectId);
    return withProgress(tree, await this.knowledgeMasteryService.findProgress(userId, subjectId));
  }

  /** 未登录时 progress 为 null */
  publicKnowledgeTree(subjectId: string, userId?: number): Promise<PublicKnowledgePointTreeNodeDto[]> {
    return userId === undefined
      ? this.knowledgePointsService.getPublishedTree(subjectId)
      : this.knowledgeTree(userId, subjectId);
  }

  async weakPoints(userId: number, subjectId: string): Promise<WeakPointDto[]> {
    await this.subjectsService.getPublishedSubject(subjectId);
    const weakPoints = await this.knowledgeMasteryService.findWeakPoints(userId, subjectId);
    const points = new Map(
      (await this.knowledgePointsService.findByIds(weakPoints.map((item) => item.knowledgePointId))).map((point) => [
        point.id,
        point,
      ]),
    );
    return weakPoints.flatMap((item) => {
      const point = points.get(item.knowledgePointId);
      return point ? [{ ...item, name: point.name, path: point.path }] : [];
    });
  }

  async checkins(userId: number, month?: string): Promise<CheckinCalendarDto> {
    const today = businessDate();
    const target = month ?? today.slice(0, 7);
    const [days, streak] = await Promise.all([
      this.checkInService.findMonth(userId, target),
      this.checkInService.findStreak(userId, today),
    ]);
    return {
      month: target,
      days: days.map(({ date, reason }) => ({ date, reason })),
      streakDays: streak.streakDays,
      checkedInToday: streak.checkedInToday,
    };
  }
}
