import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { FeedbacksService } from './feedbacks.service';
import { Feedback, FeedbackType, QUESTION_REPORT_TYPES } from './domain/feedback';
import { FeedbackChanges } from './infrastructure/persistence/feedback.repository';
import { CreateQuestionReportDto } from './dto/create-question-report.dto';
import { QueryAdminQuestionReportDto, QueryQuestionReportDto } from './dto/query-question-report.dto';
import { UpdateQuestionReportDto } from './dto/update-question-report.dto';
import { AdminQuestionReportDetailDto, AdminQuestionReportDto, QuestionReportItemDto } from './dto/question-report.dto';
import { QuestionAccessService } from '../practice/question-access.service';
import { QuestionsService } from '../questions/questions.service';
import { QuestionType } from '../questions/domain/question-type';
import { QuestionUnit } from '../questions/domain/question-unit';
import { ErrataService } from '../errata/errata.service';
import { Errata, ErrataStatus } from '../errata/domain/errata';
import { IPaginationOptions } from '../../common/types/pagination-options';

type Page<T> = { data: T[]; total: number; paginationOptions: IPaginationOptions };

function unprocessable(field: string, error: string): UnprocessableEntityException {
  return new UnprocessableEntityException({ errors: { [field]: error } });
}

@Injectable()
export class QuestionReportsService {
  constructor(
    private readonly feedbacksService: FeedbacksService,
    private readonly questionAccessService: QuestionAccessService,
    private readonly questionsService: QuestionsService,
    private readonly errataService: ErrataService,
  ) {}

  async create(userId: number, questionId: string, dto: CreateQuestionReportDto): Promise<Feedback> {
    const question = await this.questionAccessService.assertAccessible(userId, questionId);
    return this.feedbacksService.createQuestionReport(userId, {
      questionId: question.id,
      questionVersion: question.currentVersion,
      reason: dto.reason,
      content: dto.content ?? '',
      images: dto.images,
      contact: dto.contact,
    });
  }

  async findMine(userId: number, query: QueryQuestionReportDto): Promise<Page<QuestionReportItemDto>> {
    const paginationOptions = { page: query.page ?? 1, limit: query.limit ?? 20 };
    const { data, total } = await this.feedbacksService.findPage(
      { userId, types: [FeedbackType.QUESTION_ERROR], status: query.status },
      paginationOptions,
    );
    const summaries = await this.publicSummaries(
      data.flatMap((report) => report.questionId ?? []),
      userId,
    );
    return {
      data: data.map((report) =>
        Object.assign(new QuestionReportItemDto(), report, {
          question: (report.questionId && summaries.get(report.questionId)) ?? null,
        }),
      ),
      total,
      paginationOptions,
    };
  }

  async findAdminPage(query: QueryAdminQuestionReportDto): Promise<Page<AdminQuestionReportDto>> {
    const paginationOptions = { page: query.page ?? 1, limit: query.limit ?? 20 };
    const { data, total } = await this.feedbacksService.findPage(
      {
        types: query.type ? [query.type] : QUESTION_REPORT_TYPES,
        status: query.status,
        questionId: query.questionId,
      },
      paginationOptions,
    );
    return { data: await this.toAdminDtos(data), total, paginationOptions };
  }

  async getAdminDetail(id: Feedback['id']): Promise<AdminQuestionReportDetailDto> {
    const report = await this.feedbacksService.findQuestionReport(id);
    const [dto] = await this.toAdminDtos([report]);
    const errata = report.errataId ? await this.findErrata(report.errataId) : null;
    return Object.assign(new AdminQuestionReportDetailDto(), dto, { errata });
  }

  async update(id: Feedback['id'], dto: UpdateQuestionReportDto): Promise<AdminQuestionReportDetailDto> {
    const report = await this.feedbacksService.findQuestionReport(id);
    const changes: FeedbackChanges = {
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.reply !== undefined && { reply: dto.reply }),
    };
    if (dto.errataId !== undefined) {
      changes.errataId = dto.errataId;
      if (dto.errataId !== null) {
        await this.assertLinkable(report, dto.errataId);
      }
    }
    await this.feedbacksService.update(id, changes);
    if (dto.errataId) {
      const errata = await this.findErrata(dto.errataId);
      if (errata?.status === ErrataStatus.DONE) {
        await this.feedbacksService.resolveByErrata(errata.id, errata.reply);
      }
    }
    return this.getAdminDetail(id);
  }

  private async assertLinkable(report: Feedback, errataId: string): Promise<Errata> {
    if (report.type !== FeedbackType.QUESTION_ERROR) {
      throw unprocessable('errataId', 'errataNotLinkable');
    }
    const errata = await this.findErrata(errataId);
    if (!errata || errata.questionId !== report.questionId) {
      throw unprocessable('errataId', 'errataNotLinkable');
    }
    return errata;
  }

  private findErrata(id: string): Promise<Errata | null> {
    return this.errataService.findById(id).catch((error: unknown) => {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    });
  }

  private async toAdminDtos(reports: Feedback[]): Promise<AdminQuestionReportDto[]> {
    const summaries = new Map(
      (await this.questionsService.findSummariesByIds(reports.flatMap((report) => report.questionId ?? []))).map(
        (summary) => [summary.id, summary],
      ),
    );
    return reports.map((report) =>
      Object.assign(new AdminQuestionReportDto(), report, {
        question: (report.questionId && summaries.get(report.questionId)) ?? null,
      }),
    );
  }

  /** 当前版本题面，材料小题连同材料，材料本身不带小题 */
  private async publicSummaries(
    questionIds: string[],
    viewerUserId: number,
  ): Promise<Map<string, QuestionReportItemDto['question']>> {
    const questions = await this.questionsService.findByIds([...new Set(questionIds)]);
    const parents = new Map(
      (await this.questionsService.findByIds(questions.flatMap((question) => question.parentId ?? []))).map(
        (parent) => [parent.id, parent],
      ),
    );
    const items = questions.flatMap((question): { questionId: string; unit: QuestionUnit }[] => {
      if (question.type === QuestionType.MATERIAL) {
        return [{ questionId: question.id, unit: { root: question, questions: [] } }];
      }
      const root = question.parentId ? parents.get(question.parentId) : question;
      return root ? [{ questionId: question.id, unit: { root, questions: [question] } }] : [];
    });
    const dtos = await this.questionsService.toPublicUnits(
      items.map((item) => item.unit),
      viewerUserId,
    );
    return new Map(items.map((item, index) => [item.questionId, dtos[index]]));
  }
}
