import { Injectable } from '@nestjs/common';
import { WrongBookService } from './wrong-book.service';
import { WrongQuestionStatus } from './domain/wrong-question';
import { WrongBookSortField } from './infrastructure/persistence/wrong-question.repository';
import { QueryWrongBookDto, QueryWrongBookSummaryDto } from './dto/query-wrong-book.dto';
import { WrongQuestionDto, WrongQuestionStateDto, toWrongQuestionState } from './dto/wrong-question.dto';
import { WrongBookSummaryDto } from './dto/wrong-book-summary.dto';
import { QuestionsService } from '../questions/questions.service';
import { QuestionStatus } from '../questions/domain/question-status';
import { InProgressMockQuestionsService } from '../practice/in-progress-mock-questions.service';
import { HiddenReason } from '../practice/domain/hidden-reason';
import { IPaginationOptions } from '../../common/types/pagination-options';

/** 错题本列表与汇总：附带题目摘要、下架标注与模考隐藏原因 */
@Injectable()
export class WrongBookBrowseService {
  constructor(
    private readonly wrongBookService: WrongBookService,
    private readonly questionsService: QuestionsService,
    private readonly inProgressMockQuestionsService: InProgressMockQuestionsService,
  ) {}

  async findPage(
    userId: number,
    query: QueryWrongBookDto,
  ): Promise<{ data: WrongQuestionDto[]; total: number; paginationOptions: IPaginationOptions }> {
    const paginationOptions = { page: query.page ?? 1, limit: query.limit ?? 20 };
    const { data, total } = await this.wrongBookService.findManyWithPaginationAndCount(
      {
        userId,
        status: query.status ?? WrongQuestionStatus.ACTIVE,
        subjectId: query.subjectId,
        knowledgePointId: query.knowledgePointId,
        minWrongCount: query.minWrongCount,
        maxWrongCount: query.maxWrongCount,
        lastWrongFrom: query.lastWrongFrom ? new Date(query.lastWrongFrom) : undefined,
        lastWrongTo: query.lastWrongTo ? new Date(query.lastWrongTo) : undefined,
        sortBy: query.sortBy ?? WrongBookSortField.LAST_WRONG_AT,
        order: query.order ?? 'DESC',
      },
      paginationOptions,
    );
    if (data.length === 0) {
      return { data: [], total, paginationOptions };
    }
    const questions = await this.questionsService.findByIds(data.map((item) => item.questionId));
    const parentIds = [...new Set(questions.flatMap((question) => question.parentId ?? []))];
    const offlineParents = new Set(
      (await this.questionsService.findByIds(parentIds))
        .filter((parent) => parent.status !== QuestionStatus.PUBLISHED)
        .map((parent) => parent.id),
    );
    const summaries = await this.questionsService.toPublicUnits(
      questions.map((question) => ({ root: question, questions: [question] })),
      userId,
    );
    const byId = new Map(questions.map((question, index) => [question.id, { question, summary: summaries[index] }]));
    const inMock = await this.inProgressMockQuestionsService.findQuestionIds(userId);
    return {
      data: data.map((item) => {
        const found = byId.get(item.questionId);
        const hidden = inMock.has(item.questionId);
        return Object.assign(new WrongQuestionDto(), toWrongQuestionState(item), {
          ...(hidden && { lastWrongAnswer: null, consecutiveCorrect: null, lastCorrectDate: null }),
          question: found?.summary ?? null,
          isOffline:
            found?.question.status !== QuestionStatus.PUBLISHED ||
            (found.question.parentId !== null && offlineParents.has(found.question.parentId)),
          hiddenReason: hidden ? HiddenReason.MOCK_IN_PROGRESS : null,
        });
      }),
      total,
      paginationOptions,
    };
  }

  async summarize(userId: number, query: QueryWrongBookSummaryDto): Promise<WrongBookSummaryDto> {
    return Object.assign(new WrongBookSummaryDto(), await this.wrongBookService.summarize(userId, query.subjectId));
  }

  async master(userId: number, questionId: string): Promise<WrongQuestionStateDto> {
    return toWrongQuestionState(await this.wrongBookService.master(userId, questionId));
  }

  async restore(userId: number, questionId: string): Promise<WrongQuestionStateDto> {
    return toWrongQuestionState(await this.wrongBookService.restore(userId, questionId));
  }
}
