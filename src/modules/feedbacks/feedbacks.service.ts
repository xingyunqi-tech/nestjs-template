import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CreateFeedbackDto } from './dto/create-feedback.dto';
import { FeedbackChanges, FeedbackFilter, FeedbackRepository } from './infrastructure/persistence/feedback.repository';
import {
  Feedback,
  FeedbackStatus,
  FeedbackType,
  GENERAL_FEEDBACK_TYPES,
  QUESTION_REPORT_TYPES,
  QuestionReportReason,
} from './domain/feedback';
import { IPaginationOptions } from '../../common/types/pagination-options';
import { TransactionHandle } from '../../common/database/transaction-handle';

export interface QuestionReportInput {
  questionId: string;
  questionVersion: number;
  reason: QuestionReportReason;
  content: string;
  images?: string[];
  contact?: string;
}

function feedbackNotFound(): NotFoundException {
  return new NotFoundException({ error: 'feedbackNotFound' });
}

@Injectable()
export class FeedbacksService {
  private readonly logger = new Logger(FeedbacksService.name);

  constructor(private readonly feedbackRepository: FeedbackRepository) {}

  async create(userId: number, createFeedbackDto: CreateFeedbackDto): Promise<Feedback> {
    this.logger.log(`Creating feedback for user: ${userId}, type: ${createFeedbackDto.type}`);

    const feedback = await this.feedbackRepository.create({
      userId,
      type: createFeedbackDto.type,
      content: createFeedbackDto.content,
      images: createFeedbackDto.images,
      contact: createFeedbackDto.contact,
    });

    this.logger.log(`Feedback created: ${feedback.id}`);
    return feedback;
  }

  createQuestionReport(userId: number, input: QuestionReportInput): Promise<Feedback> {
    return this.feedbackRepository.create({
      userId,
      type: FeedbackType.QUESTION_ERROR,
      content: input.content,
      images: input.images,
      contact: input.contact,
      questionId: input.questionId,
      questionVersion: input.questionVersion,
      reason: input.reason,
    });
  }

  async findManyWithPagination({
    userId,
    type,
    status,
    paginationOptions,
  }: {
    userId: number;
    type?: FeedbackType;
    status?: FeedbackStatus;
    paginationOptions: IPaginationOptions;
  }): Promise<Feedback[]> {
    return this.feedbackRepository.findManyWithPagination({
      userId,
      type,
      status,
      paginationOptions,
    });
  }

  findManyWithPaginationAndCount({
    userId,
    type,
    status,
    paginationOptions,
  }: {
    userId: number;
    type?: FeedbackType;
    status?: FeedbackStatus;
    paginationOptions: IPaginationOptions;
  }): Promise<{ data: Feedback[]; total: number }> {
    return this.feedbackRepository.findPage(
      { userId, types: type ? [type] : GENERAL_FEEDBACK_TYPES, status },
      paginationOptions,
    );
  }

  findPage(
    filter: FeedbackFilter,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: Feedback[]; total: number }> {
    return this.feedbackRepository.findPage(filter, paginationOptions);
  }

  async findById(id: Feedback['id']): Promise<Feedback | null> {
    return this.feedbackRepository.findById(id);
  }

  findByIds(ids: Feedback['id'][]): Promise<Feedback[]> {
    return this.feedbackRepository.findByIds(ids);
  }

  async findQuestionReport(id: Feedback['id']): Promise<Feedback> {
    const feedback = await this.feedbackRepository.findById(id);
    if (!feedback || !QUESTION_REPORT_TYPES.includes(feedback.type)) {
      throw feedbackNotFound();
    }
    return feedback;
  }

  async update(id: Feedback['id'], changes: FeedbackChanges): Promise<Feedback> {
    const updated = await this.feedbackRepository.update(id, changes);
    if (!updated) {
      throw feedbackNotFound();
    }
    return updated;
  }

  async countByUserId(userId: number): Promise<number> {
    return this.feedbackRepository.countByUserId(userId);
  }

  linkErrata(handle: TransactionHandle, ids: Feedback['id'][], questionId: string, errataId: string): Promise<number> {
    return this.feedbackRepository.linkErrata(handle, ids, questionId, errataId);
  }

  resolveByErrata(errataId: string, reply: string): Promise<number> {
    return this.feedbackRepository.resolveByErrata(errataId, reply);
  }
}
