import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  MockPaperMissingError,
  PracticeSessionRepository,
  RecordGrade,
} from './infrastructure/persistence/practice-session.repository';
import { QuestionPickerService } from './question-picker.service';
import { MockSubmitScheduler } from './mock-submit.scheduler';
import { StatsEventPublisher } from './ports/stats-event.publisher';
import { PracticeMode } from './domain/practice-mode';
import { PracticeSession, PracticeSessionStatus, ScoringScheme, SubmitType } from './domain/practice-session';
import { gradeAnswer } from './domain/answer-grading';
import {
  DEFAULT_OFFLINE_SYNC_WINDOW_MIN,
  canTakeOver,
  mockDurationSec,
  mockSubmitType,
  mockTiming,
} from './domain/mock-exam';
import { PapersService } from '../papers/papers.service';
import { Paper } from '../papers/domain/paper';
import { PaperType } from '../papers/domain/paper-type';
import { businessDate } from '../papers/domain/business-date';
import { ContentStatus } from '../exams/domain/content-status';
import { QuestionsService } from '../questions/questions.service';
import { AppConfigService } from '../config/config.service';
import { BusinessException } from '../../common/exceptions/business.exception';

const MAX_ENTER_ATTEMPTS = 3;

export interface MockEntry {
  session: PracticeSession;
  isActiveDevice: boolean;
}

function paperNotFound(): UnprocessableEntityException {
  return new UnprocessableEntityException({ errors: { paperId: 'paperNotFound' } });
}

const toCents = (value: number): number => Math.round(value * 100);

/** 模拟考试的开考、续考接管与交卷 */
@Injectable()
export class MockExamService {
  private readonly logger = new Logger(MockExamService.name);

  constructor(
    private readonly practiceSessionRepository: PracticeSessionRepository,
    private readonly questionPickerService: QuestionPickerService,
    private readonly papersService: PapersService,
    private readonly questionsService: QuestionsService,
    private readonly appConfigService: AppConfigService,
    private readonly mockSubmitScheduler: MockSubmitScheduler,
    private readonly statsEventPublisher: StatsEventPublisher,
  ) {}

  /** 已有进行中的模考时续考，新设备在截止前接管；已过自动交卷时间的先交卷并返回该会话 */
  async enter(userId: number, subjectId: string, paperId: string, deviceId: string): Promise<MockEntry> {
    const paper = await this.findPaper(userId, subjectId, paperId);
    for (let attempt = 0; attempt < MAX_ENTER_ATTEMPTS; attempt += 1) {
      const existing = await this.practiceSessionRepository.findInProgressMock(userId, paperId);
      if (existing) {
        return this.resume(existing.id, deviceId);
      }
      const created = await this.create(userId, paper, deviceId);
      if (created) {
        await this.mockSubmitScheduler.schedule(created.id, created.autoSubmitAt!);
        return { session: created, isActiveDevice: true };
      }
    }
    throw new BusinessException('mockSessionBusy');
  }

  /** 行锁内校验状态，只生效一次；超时一题未答置为放弃；提交后按会话发布统计事件 */
  async submit(sessionId: string, manual: boolean): Promise<Date | null> {
    let notDueUntil: Date | null = null;
    const status = await this.practiceSessionRepository.transaction(async (tx) => {
      const locked = await tx.lockSessionForWrite(sessionId);
      if (locked?.mode !== PracticeMode.MOCK || locked.status !== PracticeSessionStatus.IN_PROGRESS) {
        return null;
      }
      const now = new Date();
      if (!manual && locked.autoSubmitAt && now < locked.autoSubmitAt) {
        notDueUntil = locked.autoSubmitAt;
        return null;
      }
      const submitType = mockSubmitType(locked, manual, now);
      if (submitType === SubmitType.AUTO_TIMEOUT && locked.answeredCount === 0) {
        await tx.closeMock(sessionId, { status: PracticeSessionStatus.ABANDONED });
        return PracticeSessionStatus.ABANDONED;
      }

      const records = (await tx.findRecordsForUpdate(sessionId, locked.questionIds)).filter(
        (record) => record.answer !== null,
      );
      const [paper, paperQuestions, questions] = await Promise.all([
        this.papersService.findById(locked.paperId!),
        this.papersService.findQuestions(locked.paperId!),
        this.questionsService.findByIds(records.map((record) => record.questionId)),
      ]);
      const scores = new Map(paperQuestions.map((row) => [row.questionId, row.score]));
      const questionMap = new Map(questions.map((question) => [question.id, question]));
      const grades: RecordGrade[] = [];
      for (const record of records) {
        const question = questionMap.get(record.questionId);
        if (!question) {
          continue;
        }
        const grade = gradeAnswer(question.type, question.answer, record.answer, {
          fullScore: scores.get(record.questionId) ?? 0,
          multiScoringRule: paper.multiScoringRule,
        });
        if (grade.isCorrect !== null) {
          grades.push({
            id: record.id,
            isCorrect: grade.isCorrect,
            isPartial: grade.isPartial,
            score: grade.score ?? 0,
          });
        }
      }
      await tx.gradeRecords(grades, now, businessDate(now));
      await tx.closeMock(sessionId, {
        status: PracticeSessionStatus.SUBMITTED,
        submitType,
        submittedAt: now,
        durationSec: mockDurationSec(locked, now),
        score: grades.reduce((sum, grade) => sum + toCents(grade.score), 0) / 100,
        correctCount: grades.filter((grade) => grade.isCorrect).length,
        scoringScheme: ScoringScheme.OBJECTIVE_ONLY,
        totalScore: paper.objectiveScore,
      });
      return PracticeSessionStatus.SUBMITTED;
    });

    if (status === PracticeSessionStatus.SUBMITTED) {
      await this.statsEventPublisher.publishSession(sessionId).catch((error: unknown) => {
        this.logger.warn(
          `Failed to publish stats event for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    }
    return notDueUntil;
  }

  /** 未到自动交卷时间时不交卷，返回自动交卷时间 */
  autoSubmit(sessionId: string): Promise<Date | null> {
    return this.submit(sessionId, false);
  }

  private async resume(sessionId: string, deviceId: string): Promise<MockEntry> {
    const overdue = await this.practiceSessionRepository.transaction(async (tx) => {
      const locked = await tx.lockSessionForWrite(sessionId);
      if (locked?.status !== PracticeSessionStatus.IN_PROGRESS) {
        return false;
      }
      const now = new Date();
      if (locked.autoSubmitAt && now >= locked.autoSubmitAt) {
        return true;
      }
      if (locked.activeDeviceId !== deviceId && canTakeOver(locked, now)) {
        await tx.setActiveDevice(sessionId, deviceId);
      }
      return false;
    });
    if (overdue) {
      await this.submit(sessionId, false);
    }
    const session = (await this.practiceSessionRepository.findById(sessionId))!;
    return {
      session,
      isActiveDevice: session.status === PracticeSessionStatus.IN_PROGRESS && session.activeDeviceId === deviceId,
    };
  }

  private async create(userId: number, paper: Paper, deviceId: string): Promise<PracticeSession | null> {
    if (paper.status !== ContentStatus.PUBLISHED) {
      throw paperNotFound();
    }
    const picked = await this.questionPickerService.pickFromPaper(paper.id);
    if (picked.questionIds.length === 0) {
      throw new BusinessException('noQuestionsAvailable');
    }
    const window = await this.appConfigService.getValue('practice.offlineSyncWindowMin');
    const startedAt = new Date();
    const timing = mockTiming(
      startedAt,
      paper.durationMin,
      typeof window === 'number' && Number.isFinite(window) && window >= 0 ? window : DEFAULT_OFFLINE_SYNC_WINDOW_MIN,
    );
    return this.practiceSessionRepository
      .insertMockIfAbsent({
        userId,
        subjectId: paper.subjectId,
        mode: PracticeMode.MOCK,
        paperId: paper.id,
        dailyDate: null,
        scope: {},
        questionIds: picked.questionIds,
        questionVersions: picked.questionVersions,
        activeDeviceId: deviceId,
        startedAt,
        deadlineAt: timing.deadlineAt,
        autoSubmitAt: timing.autoSubmitAt,
        scoringScheme: ScoringScheme.OBJECTIVE_ONLY,
        totalScore: paper.objectiveScore,
      })
      .catch((error: unknown) => {
        throw error instanceof MockPaperMissingError ? paperNotFound() : error;
      });
  }

  private async findPaper(userId: number, subjectId: string, paperId: string): Promise<Paper> {
    const paper = await this.papersService.findById(paperId).catch((error: unknown) => {
      throw error instanceof NotFoundException ? paperNotFound() : error;
    });
    if (paper.subjectId !== subjectId || (paper.type === PaperType.GENERATED && paper.ownerUserId !== userId)) {
      throw paperNotFound();
    }
    return paper;
  }
}
