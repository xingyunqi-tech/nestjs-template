import { Injectable, NotFoundException } from '@nestjs/common';
import {
  WrongQuestionRepository,
  WrongBookCounts,
  WrongBookFilter,
} from './infrastructure/persistence/wrong-question.repository';
import { WrongQuestion } from './domain/wrong-question';
import { wrongBookOutcomeOf } from './domain/stats-outcome';
import { businessWeekStart } from './domain/week-start';
import { AppConfigService } from '../config/config.service';
import { StatsRecord } from '../study-stats/domain/stats-record';
import { TransactionHandle } from '../../common/database/transaction-handle';
import { IPaginationOptions } from '../../common/types/pagination-options';
import { positiveInteger } from '../../common/utils/number.utils';

const DEFAULT_MASTER_THRESHOLD = 3;

function notFound(): NotFoundException {
  return new NotFoundException({ error: 'wrongQuestionNotFound' });
}

@Injectable()
export class WrongBookService {
  constructor(
    private readonly wrongQuestionRepository: WrongQuestionRepository,
    private readonly appConfigService: AppConfigService,
  ) {}

  /** 在统计事件处理器的事务内更新错题本 */
  async applyStatsRecord(handle: TransactionHandle, record: StatsRecord): Promise<void> {
    const outcome = wrongBookOutcomeOf(record);
    if (outcome === 'wrong') {
      await this.wrongQuestionRepository.recordWrong(handle, {
        userId: record.userId,
        questionId: record.questionId,
        subjectId: record.questionSubjectId,
        answer: record.answer,
        wrongAt: record.gradedAt ?? new Date(),
      });
      return;
    }
    if (outcome === 'correct') {
      await this.wrongQuestionRepository.recordCorrect(handle, {
        userId: record.userId,
        questionId: record.questionId,
        statDate: record.statDate!,
        masterThreshold: await this.masterThreshold(),
      });
    }
  }

  rebuildFromRecords(handle: TransactionHandle, userId: number, questionId: string, subjectId: string): Promise<void> {
    return this.wrongQuestionRepository.rebuildFromRecords(handle, { userId, questionId, subjectId });
  }

  findActiveQuestionIds(userId: number, subjectId: string): Promise<string[]> {
    return this.wrongQuestionRepository.findActivePublishedQuestionIds(userId, subjectId);
  }

  findQuestionIdsInBook(userId: number, questionIds: string[]): Promise<string[]> {
    return this.wrongQuestionRepository.findQuestionIdsInBook(userId, questionIds);
  }

  findManyWithPaginationAndCount(
    filter: WrongBookFilter,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: WrongQuestion[]; total: number }> {
    return this.wrongQuestionRepository.findManyWithPaginationAndCount(filter, paginationOptions);
  }

  async summarize(userId: number, subjectId?: string): Promise<WrongBookCounts & { weekStart: Date }> {
    const weekStart = businessWeekStart();
    return { ...(await this.wrongQuestionRepository.countSummary(userId, weekStart, subjectId)), weekStart };
  }

  async master(userId: number, questionId: string): Promise<WrongQuestion> {
    const item = await this.wrongQuestionRepository.master(userId, questionId);
    if (!item) {
      throw notFound();
    }
    return item;
  }

  async restore(userId: number, questionId: string): Promise<WrongQuestion> {
    const item = await this.wrongQuestionRepository.restore(userId, questionId);
    if (!item) {
      throw notFound();
    }
    return item;
  }

  private async masterThreshold(): Promise<number> {
    return positiveInteger(await this.appConfigService.getValue('wrongBook.masterThreshold'), DEFAULT_MASTER_THRESHOLD);
  }
}
