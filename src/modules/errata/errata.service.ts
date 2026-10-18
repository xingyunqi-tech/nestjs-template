import { Injectable, Logger, NotFoundException, Optional, UnprocessableEntityException } from '@nestjs/common';
import { ErrataConflictError, ErrataFilter, ErrataRepository } from './infrastructure/persistence/errata.repository';
import { Errata, ErrataStatus } from './domain/errata';
import { CreateErrataDto } from './dto/create-errata.dto';
import { ErrataQueue } from './errata.queue';
import { QuestionsService } from '../questions/questions.service';
import { Question } from '../questions/domain/question';
import { PapersService } from '../papers/papers.service';
import { AnswerRegradeService, ChangedStatsRecord, ErrataTarget } from '../practice/answer-regrade.service';
import { StatsEventService } from '../study-stats/stats-event.service';
import { LearningStatsService } from '../study-stats/learning-stats.service';
import { WrongBookService } from '../wrong-book/wrong-book.service';
import { FeedbacksService } from '../feedbacks/feedbacks.service';
import { FeedbackType } from '../feedbacks/domain/feedback';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCategory, NotificationType } from '../notifications/domain/notification';
import { BusinessException } from '../../common/exceptions/business.exception';
import { IPaginationOptions } from '../../common/types/pagination-options';
import { TransactionHandle } from '../../common/database/transaction-handle';
import { AlertLevel, AlertReporter } from '../../infrastructure/alerting/alert-reporter';

export const ERRATA_FAILED_ALERT = 'errataFailed';
export const DEFAULT_ERRATA_REPLY = '感谢反馈，该题答案与解析已勘误，相关作答已按新答案重新判分。';
export const DEFAULT_ANALYSIS_ERRATA_REPLY = '感谢反馈，该题解析已勘误。';
export const ERRATA_DEFER_MS = 5000;
export const ERRATA_STALE_MS = 10 * 60_000;
const NOTIFICATION_TITLE = '题目勘误';
const ANSWER_NOTIFICATION = '你作答过的一道题目答案已勘误，相关成绩、错题本与学习统计已按新答案更新。';
const ANALYSIS_NOTIFICATION = '你作答过的一道题目解析已勘误，可在题目解析中查看更正后的内容。';
const NOTIFY_BATCH_SIZE = 500;
const USER_BATCH_SIZE = 500;
const STALE_BATCH_SIZE = 50;

export type ErrataExecution =
  { status: 'skipped' } | { status: 'deferred'; errata: Errata } | { status: 'finished'; errata: Errata };

function errataNotFound(): NotFoundException {
  return new NotFoundException({ error: 'errataNotFound' });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 勘误：生成 ERRATA 版本，按用户分批重判历史作答并修正统计，完成后通知受影响用户 */
@Injectable()
export class ErrataService {
  private readonly logger = new Logger(ErrataService.name);

  constructor(
    private readonly errataRepository: ErrataRepository,
    private readonly errataQueue: ErrataQueue,
    private readonly questionsService: QuestionsService,
    private readonly papersService: PapersService,
    private readonly answerRegradeService: AnswerRegradeService,
    private readonly statsEventService: StatsEventService,
    private readonly learningStatsService: LearningStatsService,
    private readonly wrongBookService: WrongBookService,
    private readonly feedbacksService: FeedbacksService,
    private readonly notificationsService: NotificationsService,
    @Optional() private readonly alertReporter?: AlertReporter,
  ) {}

  async create(questionId: string, dto: CreateErrataDto, createdBy: number): Promise<Errata> {
    const reportIds = [...new Set(dto.reportIds ?? [])];
    await this.assertReports(reportIds, questionId);
    if (await this.errataRepository.findActiveByQuestion(questionId)) {
      throw new BusinessException('errataInProgress');
    }
    const errata = await this.questionsService
      .applyErrata(questionId, { answer: dto.answer, analysis: dto.analysis }, async (handle, version) => {
        const created = await this.errataRepository.insert(handle, {
          questionId,
          fromVersion: version.fromVersion,
          toVersion: version.toVersion,
          answerChanged: version.answerChanged,
          reply: dto.reply ?? (version.answerChanged ? DEFAULT_ERRATA_REPLY : DEFAULT_ANALYSIS_ERRATA_REPLY),
          createdBy,
        });
        await this.papersService.raiseQuestionVersion(handle, questionId, version.toVersion);
        await this.answerRegradeService.raiseInProgressSessionVersions(handle, questionId, version.toVersion);
        await this.feedbacksService.linkErrata(handle, reportIds, questionId, created.id);
        return created;
      })
      .catch((error: unknown) => {
        throw error instanceof ErrataConflictError ? new BusinessException('errataInProgress') : error;
      });
    await this.dispatch(errata.id);
    return errata;
  }

  findManyWithPaginationAndCount(
    filter: ErrataFilter,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: Errata[]; total: number }> {
    return this.errataRepository.findManyWithPaginationAndCount(filter, paginationOptions);
  }

  async findById(id: Errata['id']): Promise<Errata> {
    const errata = await this.errataRepository.findById(id);
    if (!errata) {
      throw errataNotFound();
    }
    return errata;
  }

  /** 失败或超过 ERRATA_STALE_MS 未进展的任务从中断处继续 */
  async retry(id: Errata['id']): Promise<Errata> {
    const errata = await this.findById(id);
    if (errata.status === ErrataStatus.FAILED) {
      const reopened = await this.errataRepository.reopen(id).catch((error: unknown) => {
        throw error instanceof ErrataConflictError ? new BusinessException('errataInProgress') : error;
      });
      if (reopened) {
        await this.dispatch(id, true);
      }
    } else if (await this.errataRepository.isStaleActive(id, ERRATA_STALE_MS)) {
      await this.errataRepository.touch(id);
      await this.dispatch(id, true);
    } else {
      throw new UnprocessableEntityException({ errors: { status: 'errataNotRetryable' } });
    }
    return this.findById(id);
  }

  /** 重新派发超过 ERRATA_STALE_MS 未进展的 PENDING 与 RUNNING 任务，返回派发数 */
  async resumeStale(): Promise<number> {
    const stale = await this.errataRepository.findStaleActive(ERRATA_STALE_MS, STALE_BATCH_SIZE);
    for (const errata of stale) {
      await this.errataRepository.touch(errata.id);
      await this.dispatch(errata.id, true);
    }
    return stale.length;
  }

  /** 执行或续跑任务；抢不到用户锁的用户本轮跳过，有跳过时返回 deferred 供延迟后再执行；出错时抛出供队列重试 */
  async execute(id: Errata['id']): Promise<ErrataExecution> {
    const errata = await this.errataRepository.start(id);
    if (!errata) {
      return { status: 'skipped' };
    }
    const question = await this.questionsService.findById(errata.questionId);
    const target: ErrataTarget = { questionId: question.id, toVersion: errata.toVersion, type: question.type };
    const pending = await this.answerRegradeService.countPendingUsers(target, id);
    await this.errataRepository.setAffectedUsers(id, errata.processedUsers + pending);

    let afterUserId = 0;
    let skipped = 0;
    for (;;) {
      const userIds = await this.answerRegradeService.findPendingUsers(target, afterUserId, USER_BATCH_SIZE);
      for (const userId of userIds) {
        if (!(await this.processUser(errata, question, target, userId))) {
          skipped += 1;
        }
      }
      if (userIds.length < USER_BATCH_SIZE) {
        break;
      }
      afterUserId = userIds[userIds.length - 1];
    }
    if (skipped > 0) {
      await this.errataRepository.touch(id);
      return { status: 'deferred', errata };
    }

    await this.notifyUsers(errata);
    const finished = (await this.errataRepository.finish(id))!;
    await this.feedbacksService.resolveByErrata(id, errata.reply);
    return { status: 'finished', errata: finished };
  }

  async markFailed(id: Errata['id'], error: unknown): Promise<void> {
    const reason = messageOf(error);
    this.logger.error(`Errata ${id} failed: ${reason}`, error instanceof Error ? error.stack : undefined);
    await this.errataRepository.fail(id, reason);
    try {
      await this.alertReporter?.raise(
        ERRATA_FAILED_ALERT,
        AlertLevel.WARN,
        `勘误任务 ${id} 失败：${reason}`,
        { errataId: id, reason },
        `${ERRATA_FAILED_ALERT}:${id}`,
      );
    } catch (alertError) {
      this.logger.error(`Failed to raise alert for errata ${id}: ${messageOf(alertError)}`);
    }
  }

  /** 在 stats:user:{userId} 锁与单事务内重判该用户作答并修正统计，返回是否处理；锁被占用时不处理 */
  private async processUser(
    errata: Errata,
    question: Question,
    target: ErrataTarget,
    userId: number,
  ): Promise<boolean> {
    const result = await this.statsEventService.withUserLock(userId, async () => {
      const changed = await this.errataRepository.transaction(async (handle) => {
        await this.statsEventService.lockUserStats(handle, userId);
        const records = await this.answerRegradeService.regradeUser(handle, userId, target, question.answer);
        if (records.length > 0) {
          await this.correctStats(handle, question, userId, records);
        }
        await this.errataRepository.markUserProcessed(handle, errata.id, userId);
        return records.length > 0;
      });
      if (changed) {
        await this.learningStatsService.invalidateKnowledgeCache(userId);
      }
    });
    return result === 'done';
  }

  private async correctStats(
    handle: TransactionHandle,
    question: Question,
    userId: number,
    records: ChangedStatsRecord[],
  ): Promise<void> {
    const delta = (record: ChangedStatsRecord): number => (record.isCorrect ? 1 : -1);
    await this.learningStatsService.correctForErrata(
      handle,
      userId,
      question.id,
      records.map((record) => ({ date: record.statDate, subjectId: record.subjectId, correct: delta(record) })),
    );
    await this.wrongBookService.rebuildFromRecords(handle, userId, question.id, question.subjectId);
    await this.questionsService.adjustStatCorrect(
      handle,
      question.id,
      records.filter((record) => record.firstForQuestion).reduce((sum, record) => sum + delta(record), 0),
    );
  }

  private async notifyUsers(errata: Errata): Promise<void> {
    for (;;) {
      const notified = await this.errataRepository.transaction(async (handle) => {
        const userIds = await this.errataRepository.claimNoticeUsers(handle, errata.id, NOTIFY_BATCH_SIZE);
        await this.notificationsService.createInAppBatch(handle, {
          userIds,
          type: NotificationType.INFO,
          category: NotificationCategory.STUDY,
          title: NOTIFICATION_TITLE,
          content: errata.answerChanged ? ANSWER_NOTIFICATION : ANALYSIS_NOTIFICATION,
          metadata: { errataId: errata.id, questionId: errata.questionId },
        });
        return userIds.length;
      });
      if (notified < NOTIFY_BATCH_SIZE) {
        return;
      }
    }
  }

  /** replace 为 true 时替换同一任务仍未结束的 job */
  private async dispatch(id: Errata['id'], replace = false): Promise<void> {
    if (this.errataQueue.enabled) {
      await this.errataQueue.publish(id, replace).catch((error: unknown) => this.markFailed(id, error));
      return;
    }
    setImmediate(() => this.runInProcess(id));
  }

  private runInProcess(id: Errata['id']): void {
    this.execute(id)
      .then((execution) => {
        if (execution.status === 'deferred') {
          setTimeout(() => this.runInProcess(id), ERRATA_DEFER_MS).unref();
        }
      })
      .catch((error: unknown) => this.markFailed(id, error));
  }

  private async assertReports(reportIds: number[], questionId: string): Promise<void> {
    if (reportIds.length === 0) {
      return;
    }
    const reports = await this.feedbacksService.findByIds(reportIds);
    const valid = reports.filter(
      (report) => report.type === FeedbackType.QUESTION_ERROR && report.questionId === questionId,
    );
    if (valid.length !== reportIds.length) {
      throw new UnprocessableEntityException({ errors: { reportIds: 'questionReportNotFound' } });
    }
  }
}
