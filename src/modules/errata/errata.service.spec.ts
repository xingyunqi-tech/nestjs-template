import type { Mock, Mocked } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import {
  DEFAULT_ANALYSIS_ERRATA_REPLY,
  DEFAULT_ERRATA_REPLY,
  ERRATA_FAILED_ALERT,
  ERRATA_STALE_MS,
  ErrataService,
} from './errata.service';
import { ErrataConflictError, ErrataRepository } from './infrastructure/persistence/errata.repository';
import { Errata, ErrataStatus } from './domain/errata';
import { ErrataVersion, QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { QuestionType } from '../questions/domain/question-type';
import { PapersService } from '../papers/papers.service';
import { AnswerRegradeService, ChangedStatsRecord } from '../practice/answer-regrade.service';
import { StatsEventService } from '../study-stats/stats-event.service';
import { LearningStatsService } from '../study-stats/learning-stats.service';
import { WrongBookService } from '../wrong-book/wrong-book.service';
import { FeedbacksService } from '../feedbacks/feedbacks.service';
import { Feedback, FeedbackType } from '../feedbacks/domain/feedback';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCategory } from '../notifications/domain/notification';
import { AlertReporter } from '../../infrastructure/alerting/alert-reporter';
import { BusinessException } from '../../common/exceptions/business.exception';
import { TransactionHandle } from '../../common/database/transaction-handle';

const HANDLE = Object.freeze({}) as TransactionHandle;

const question = Object.assign(new Question(), {
  id: 'q1',
  subjectId: 'sub1',
  type: QuestionType.SINGLE,
  answer: { keys: ['B'] },
  currentVersion: 2,
});

const errata = (overrides: Partial<Errata> = {}): Errata =>
  Object.assign(new Errata(), {
    id: 'e1',
    questionId: 'q1',
    fromVersion: 1,
    toVersion: 2,
    answerChanged: true,
    status: ErrataStatus.RUNNING,
    affectedUsers: 0,
    processedUsers: 0,
    reply: '已勘误',
    failureReason: null,
    createdBy: 1,
    ...overrides,
  });

const changed = (overrides: Partial<ChangedStatsRecord> = {}): ChangedStatsRecord => ({
  statDate: '2026-10-10',
  subjectId: 'sub1',
  firstForQuestion: false,
  isCorrect: true,
  ...overrides,
});

describe('ErrataService', () => {
  let repository: Mocked<ErrataRepository>;
  let queue: { enabled: boolean; publish: Mock };
  let questions: Record<'applyErrata' | 'findById' | 'adjustStatCorrect', Mock>;
  let version: ErrataVersion;
  let papers: Mocked<Pick<PapersService, 'raiseQuestionVersion'>>;
  let regrade: Mocked<
    Pick<
      AnswerRegradeService,
      'raiseInProgressSessionVersions' | 'countPendingUsers' | 'findPendingUsers' | 'regradeUser'
    >
  >;
  let stats: { withUserLock: Mock; lockUserStats: Mock };
  let learning: Mocked<Pick<LearningStatsService, 'correctForErrata' | 'invalidateKnowledgeCache'>>;
  let wrongBook: Mocked<Pick<WrongBookService, 'rebuildFromRecords'>>;
  let feedbacks: Mocked<Pick<FeedbacksService, 'findByIds' | 'linkErrata' | 'resolveByErrata'>>;
  let notifications: Mocked<Pick<NotificationsService, 'createInAppBatch'>>;
  let alerts: Mocked<AlertReporter>;
  let service: ErrataService;

  beforeEach(() => {
    version = { question, fromVersion: 1, toVersion: 2, answerChanged: true };
    repository = {
      insert: vi.fn().mockResolvedValue(errata({ status: ErrataStatus.PENDING })),
      findById: vi.fn().mockResolvedValue(errata()),
      findActiveByQuestion: vi.fn().mockResolvedValue(null),
      findManyWithPaginationAndCount: vi.fn(),
      findStaleActive: vi.fn().mockResolvedValue([]),
      isStaleActive: vi.fn().mockResolvedValue(false),
      start: vi.fn().mockResolvedValue(errata()),
      setAffectedUsers: vi.fn().mockResolvedValue(undefined),
      touch: vi.fn().mockResolvedValue(undefined),
      markUserProcessed: vi.fn().mockResolvedValue(undefined),
      claimNoticeUsers: vi.fn().mockResolvedValue({ claimed: 0, activeUserIds: [] }),
      removeUserLinks: vi.fn(),
      finish: vi.fn().mockResolvedValue(errata({ status: ErrataStatus.DONE })),
      fail: vi.fn().mockResolvedValue(undefined),
      reopen: vi.fn().mockResolvedValue(true),
      transaction: vi.fn((work: (handle: TransactionHandle) => Promise<unknown>) => work(HANDLE)) as never,
    };
    queue = { enabled: true, publish: vi.fn().mockResolvedValue(undefined) };
    questions = {
      applyErrata: vi.fn(
        (_id: string, _changes: unknown, work: (handle: TransactionHandle, value: ErrataVersion) => unknown) =>
          work(HANDLE, version),
      ),
      findById: vi.fn().mockResolvedValue(question),
      adjustStatCorrect: vi.fn().mockResolvedValue(undefined),
    };
    papers = { raiseQuestionVersion: vi.fn().mockResolvedValue(1) };
    regrade = {
      raiseInProgressSessionVersions: vi.fn().mockResolvedValue(1),
      countPendingUsers: vi.fn().mockResolvedValue(0),
      findPendingUsers: vi.fn().mockResolvedValue([]),
      regradeUser: vi.fn().mockResolvedValue([]),
    };
    stats = {
      withUserLock: vi.fn(async (_userId: number, work: () => Promise<void>) => {
        await work();
        return 'done';
      }),
      lockUserStats: vi.fn().mockResolvedValue(undefined),
    };
    learning = {
      correctForErrata: vi.fn().mockResolvedValue(undefined),
      invalidateKnowledgeCache: vi.fn().mockResolvedValue(undefined),
    };
    wrongBook = { rebuildFromRecords: vi.fn().mockResolvedValue(undefined) };
    feedbacks = {
      findByIds: vi.fn().mockResolvedValue([]),
      linkErrata: vi.fn().mockResolvedValue(0),
      resolveByErrata: vi.fn().mockResolvedValue(0),
    };
    notifications = { createInAppBatch: vi.fn().mockResolvedValue(0) };
    alerts = { raise: vi.fn().mockResolvedValue(null) };
    service = new ErrataService(
      repository,
      queue,
      questions as unknown as QuestionsService,
      papers as unknown as PapersService,
      regrade as unknown as AnswerRegradeService,
      stats as unknown as StatsEventService,
      learning as unknown as LearningStatsService,
      wrongBook as unknown as WrongBookService,
      feedbacks as unknown as FeedbacksService,
      notifications as unknown as NotificationsService,
      alerts,
    );
  });

  describe('create', () => {
    it('should write the errata and raise paper and in-progress session versions in the version transaction', async () => {
      feedbacks.findByIds.mockResolvedValue([
        Object.assign(new Feedback(), { id: 5, type: FeedbackType.QUESTION_ERROR, questionId: 'q1' }),
      ]);

      await service.create('q1', { answer: { keys: ['B'] }, reportIds: [5, 5] }, 1);

      expect(questions.applyErrata).toHaveBeenCalledWith(
        'q1',
        { answer: { keys: ['B'] }, analysis: undefined },
        expect.any(Function),
      );
      expect(repository.insert).toHaveBeenCalledWith(HANDLE, {
        questionId: 'q1',
        fromVersion: 1,
        toVersion: 2,
        answerChanged: true,
        reply: DEFAULT_ERRATA_REPLY,
        createdBy: 1,
      });
      expect(papers.raiseQuestionVersion).toHaveBeenCalledWith(HANDLE, 'q1', 2);
      expect(regrade.raiseInProgressSessionVersions).toHaveBeenCalledWith(HANDLE, 'q1', 2);
      expect(feedbacks.linkErrata).toHaveBeenCalledWith(HANDLE, [5], 'q1', 'e1');
      expect(queue.publish).toHaveBeenCalledWith('e1', false);
    });

    it('should default the reply of an analysis-only errata', async () => {
      version = { ...version, answerChanged: false };

      await service.create('q1', { answer: { keys: ['B'] }, analysis: '新解析' }, 1);

      expect(repository.insert).toHaveBeenCalledWith(
        HANDLE,
        expect.objectContaining({ answerChanged: false, reply: DEFAULT_ANALYSIS_ERRATA_REPLY }),
      );
    });

    it('should reject when the question already has an unfinished errata', async () => {
      repository.findActiveByQuestion.mockResolvedValue(errata());

      await expect(service.create('q1', { answer: { keys: ['B'] } }, 1)).rejects.toMatchObject({
        errorKey: 'errataInProgress',
      });
      expect(questions.applyErrata).not.toHaveBeenCalled();
    });

    it('should report errataInProgress when a concurrent errata wins the unique index', async () => {
      repository.insert.mockRejectedValue(new ErrataConflictError());

      const result = service.create('q1', { answer: { keys: ['B'] } }, 1);

      await expect(result).rejects.toBeInstanceOf(BusinessException);
      await expect(result).rejects.toMatchObject({ errorKey: 'errataInProgress' });
      expect(queue.publish).not.toHaveBeenCalled();
    });

    it('should reject reports that are not question errors of the same question', async () => {
      feedbacks.findByIds.mockResolvedValue([
        Object.assign(new Feedback(), { id: 5, type: FeedbackType.QUESTION_ERROR, questionId: 'other' }),
      ]);

      await expect(service.create('q1', { answer: { keys: ['B'] }, reportIds: [5] }, 1)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });
  });

  describe('execute', () => {
    it('should skip errata that are finished or failed', async () => {
      repository.start.mockResolvedValue(null);

      await expect(service.execute('e1')).resolves.toEqual({ status: 'skipped' });
      expect(regrade.findPendingUsers).not.toHaveBeenCalled();
    });

    it('should count processed users once when resuming', async () => {
      repository.start.mockResolvedValue(errata({ processedUsers: 4 }));
      regrade.countPendingUsers.mockResolvedValue(2);

      await service.execute('e1');

      expect(regrade.countPendingUsers).toHaveBeenCalledWith(
        { questionId: 'q1', toVersion: 2, type: QuestionType.SINGLE },
        'e1',
      );
      expect(repository.setAffectedUsers).toHaveBeenCalledWith('e1', 6);
    });

    it('should regrade users batch by batch and correct their stats under the user locks', async () => {
      regrade.findPendingUsers.mockResolvedValueOnce([3, 8]);
      regrade.regradeUser
        .mockResolvedValueOnce([
          changed({ firstForQuestion: true, isCorrect: true }),
          changed({ statDate: '2026-10-11', isCorrect: false }),
        ])
        .mockResolvedValueOnce([]);

      await service.execute('e1');

      expect(regrade.findPendingUsers).toHaveBeenCalledWith(expect.anything(), 0, 500);
      expect(stats.withUserLock.mock.calls.map(([userId]) => userId)).toEqual([3, 8]);
      expect(stats.lockUserStats).toHaveBeenCalledWith(HANDLE, 3);
      expect(stats.lockUserStats.mock.invocationCallOrder[0]).toBeLessThan(
        regrade.regradeUser.mock.invocationCallOrder[0],
      );
      expect(regrade.regradeUser).toHaveBeenCalledWith(
        HANDLE,
        3,
        { questionId: 'q1', toVersion: 2, type: QuestionType.SINGLE },
        { keys: ['B'] },
      );
      expect(learning.correctForErrata).toHaveBeenCalledTimes(1);
      expect(learning.correctForErrata).toHaveBeenCalledWith(HANDLE, 3, 'q1', [
        { date: '2026-10-10', subjectId: 'sub1', correct: 1 },
        { date: '2026-10-11', subjectId: 'sub1', correct: -1 },
      ]);
      expect(wrongBook.rebuildFromRecords).toHaveBeenCalledWith(HANDLE, 3, 'q1', 'sub1');
      expect(questions.adjustStatCorrect).toHaveBeenCalledWith(HANDLE, 'q1', 1);
      expect(repository.markUserProcessed.mock.calls).toEqual([
        [HANDLE, 'e1', 3],
        [HANDLE, 'e1', 8],
      ]);
      expect(learning.invalidateKnowledgeCache).toHaveBeenCalledTimes(1);
      expect(learning.invalidateKnowledgeCache).toHaveBeenCalledWith(3);
    });

    it('should continue after the last user of a full batch', async () => {
      const full = Array.from({ length: 500 }, (_, index) => index + 1);
      regrade.findPendingUsers.mockResolvedValueOnce(full).mockResolvedValueOnce([900]);

      await service.execute('e1');

      expect(regrade.findPendingUsers.mock.calls.map(([, after]) => after)).toEqual([0, 500]);
      expect(repository.markUserProcessed).toHaveBeenCalledTimes(501);
    });

    it('should skip users whose lock is busy and defer the errata', async () => {
      regrade.findPendingUsers.mockResolvedValueOnce([3, 8]);
      stats.withUserLock.mockResolvedValueOnce('locked');

      await expect(service.execute('e1')).resolves.toMatchObject({ status: 'deferred' });

      expect(repository.markUserProcessed.mock.calls).toEqual([[HANDLE, 'e1', 8]]);
      expect(repository.touch).toHaveBeenCalledWith('e1');
      expect(repository.finish).not.toHaveBeenCalled();
      expect(notifications.createInAppBatch).not.toHaveBeenCalled();
    });

    it('should notify claimed users, finish and then resolve linked reports', async () => {
      repository.claimNoticeUsers.mockResolvedValueOnce({ claimed: 2, activeUserIds: [3, 8] });

      await expect(service.execute('e1')).resolves.toMatchObject({
        status: 'finished',
        errata: { status: ErrataStatus.DONE },
      });

      expect(repository.claimNoticeUsers).toHaveBeenCalledWith(HANDLE, 'e1', 500);
      expect(notifications.createInAppBatch).toHaveBeenCalledWith(
        HANDLE,
        expect.objectContaining({
          userIds: [3, 8],
          category: NotificationCategory.STUDY,
          content: expect.stringContaining('成绩'),
          metadata: { errataId: 'e1', questionId: 'q1' },
        }),
      );
      expect(repository.finish.mock.invocationCallOrder[0]).toBeLessThan(
        feedbacks.resolveByErrata.mock.invocationCallOrder[0],
      );
      expect(feedbacks.resolveByErrata).toHaveBeenCalledWith('e1', '已勘误');
    });

    it('should notify only active users and keep claiming while a full batch was claimed', async () => {
      repository.claimNoticeUsers
        .mockResolvedValueOnce({ claimed: 500, activeUserIds: [3] })
        .mockResolvedValueOnce({ claimed: 0, activeUserIds: [] });

      await service.execute('e1');

      expect(repository.claimNoticeUsers).toHaveBeenCalledTimes(2);
      expect(notifications.createInAppBatch.mock.calls[0][1]).toMatchObject({ userIds: [3] });
    });

    it('should not mention scores in the notice of an analysis-only errata', async () => {
      repository.start.mockResolvedValue(errata({ answerChanged: false }));
      repository.claimNoticeUsers.mockResolvedValueOnce({ claimed: 1, activeUserIds: [3] });

      await service.execute('e1');

      const [, batch] = notifications.createInAppBatch.mock.calls[0];
      expect(batch.content).toContain('解析');
      expect(batch.content).not.toContain('成绩');
    });
  });

  it('should mark the errata failed and raise an alert', async () => {
    await service.markFailed('e1', new Error('boom'));

    expect(repository.fail).toHaveBeenCalledWith('e1', 'boom');
    expect(alerts.raise).toHaveBeenCalledWith(
      ERRATA_FAILED_ALERT,
      expect.anything(),
      expect.stringContaining('boom'),
      { errataId: 'e1', reason: 'boom' },
      `${ERRATA_FAILED_ALERT}:e1`,
    );
  });

  describe('retry', () => {
    it('should reopen a failed errata and replace its job', async () => {
      repository.findById.mockResolvedValue(errata({ status: ErrataStatus.FAILED }));

      await service.retry('e1');

      expect(repository.reopen).toHaveBeenCalledWith('e1');
      expect(queue.publish).toHaveBeenCalledWith('e1', true);
    });

    it('should resume a running errata without progress for too long', async () => {
      repository.isStaleActive.mockResolvedValue(true);

      await service.retry('e1');

      expect(repository.isStaleActive).toHaveBeenCalledWith('e1', ERRATA_STALE_MS);
      expect(repository.reopen).not.toHaveBeenCalled();
      expect(repository.touch).toHaveBeenCalledWith('e1');
      expect(queue.publish).toHaveBeenCalledWith('e1', true);
    });

    it('should reject errata that are progressing or done', async () => {
      await expect(service.retry('e1')).rejects.toBeInstanceOf(UnprocessableEntityException);

      repository.findById.mockResolvedValueOnce(errata({ status: ErrataStatus.DONE }));
      await expect(service.retry('e1')).rejects.toMatchObject({
        response: { errors: { status: 'errataNotRetryable' } },
      });
      expect(queue.publish).not.toHaveBeenCalled();
    });

    it('should report errataInProgress when another errata of the question is unfinished', async () => {
      repository.findById.mockResolvedValue(errata({ status: ErrataStatus.FAILED }));
      repository.reopen.mockRejectedValue(new ErrataConflictError());

      await expect(service.retry('e1')).rejects.toMatchObject({ errorKey: 'errataInProgress' });
    });
  });

  it('should dispatch stale pending and running errata again', async () => {
    repository.findStaleActive.mockResolvedValue([errata({ id: 'e1' }), errata({ id: 'e2' })]);

    await expect(service.resumeStale()).resolves.toBe(2);

    expect(repository.findStaleActive).toHaveBeenCalledWith(ERRATA_STALE_MS, expect.any(Number));
    expect(repository.touch.mock.calls).toEqual([['e1'], ['e2']]);
    expect(queue.publish.mock.calls).toEqual([
      ['e1', true],
      ['e2', true],
    ]);
  });
});
