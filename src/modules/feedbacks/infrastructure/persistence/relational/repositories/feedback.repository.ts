import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, In } from 'typeorm';
import { FeedbackEntity } from '../entities/feedback.entity';
import { FeedbackChanges, FeedbackFilter, FeedbackRepository } from '../../feedback.repository';
import { Feedback, FeedbackStatus, FeedbackType } from '../../../../domain/feedback';
import { FeedbackMapper } from '../mappers/feedback.mapper';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';
import { TransactionHandle, entityManagerOf } from '../../../../../../common/database/transaction-handle';

function affectedOf(result: unknown): number {
  return Array.isArray(result) && typeof result[1] === 'number' ? result[1] : 0;
}

@Injectable()
export class FeedbackRelationalRepository implements FeedbackRepository {
  constructor(
    @InjectRepository(FeedbackEntity)
    private readonly feedbackRepository: Repository<FeedbackEntity>,
  ) {}

  async create(data: Omit<Feedback, 'id' | 'status' | 'createdAt' | 'updatedAt'>): Promise<Feedback> {
    const entity = this.feedbackRepository.create({
      ...FeedbackMapper.toPersistence(data),
      status: FeedbackStatus.PENDING,
    });
    const saved = await this.feedbackRepository.save(entity);
    return FeedbackMapper.toDomain(saved);
  }

  async findById(id: Feedback['id']): Promise<NullableType<Feedback>> {
    const entity = await this.feedbackRepository.findOne({
      where: { id: Number(id) },
    });
    return entity ? FeedbackMapper.toDomain(entity) : null;
  }

  async findByIds(ids: Feedback['id'][]): Promise<Feedback[]> {
    if (ids.length === 0) {
      return [];
    }
    const entities = await this.feedbackRepository.find({ where: { id: In(ids.map(Number)) } });
    return entities.map(FeedbackMapper.toDomain);
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
    const where: FindOptionsWhere<FeedbackEntity> = {
      userId: Number(userId),
    };

    if (type) {
      where.type = type;
    }
    if (status) {
      where.status = status;
    }

    const entities = await this.feedbackRepository.find({
      where,
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
      order: { createdAt: 'DESC' },
    });

    return entities.map(FeedbackMapper.toDomain);
  }

  async countByUserId(userId: number, filters: { type?: FeedbackType; status?: FeedbackStatus } = {}): Promise<number> {
    const where: FindOptionsWhere<FeedbackEntity> = {
      userId: Number(userId),
    };

    if (filters.type) {
      where.type = filters.type;
    }
    if (filters.status) {
      where.status = filters.status;
    }

    return this.feedbackRepository.count({ where });
  }

  async findPage(
    filter: FeedbackFilter,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: Feedback[]; total: number }> {
    const [entities, total] = await this.feedbackRepository.findAndCount({
      where: {
        type: In(filter.types),
        ...(filter.userId !== undefined && { userId: filter.userId }),
        ...(filter.status && { status: filter.status }),
        ...(filter.questionId && { questionId: filter.questionId }),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
    });
    return { data: entities.map(FeedbackMapper.toDomain), total };
  }

  async update(id: Feedback['id'], changes: FeedbackChanges): Promise<NullableType<Feedback>> {
    const values = FeedbackMapper.toPersistence(changes);
    if (Object.keys(values).length > 0) {
      await this.feedbackRepository.update({ id: Number(id) }, values);
    }
    return this.findById(id);
  }

  async linkErrata(
    handle: TransactionHandle,
    ids: Feedback['id'][],
    questionId: string,
    errataId: string,
  ): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const result: unknown = await entityManagerOf(handle).query(
      `UPDATE "feedback" SET "errataId" = $3,
         "status" = CASE WHEN "status" = $5 THEN $6 ELSE "status" END,
         "updatedAt" = now()
       WHERE "id" = ANY($1::int[]) AND "questionId" = $2 AND "type" = $4`,
      [
        ids.map(Number),
        questionId,
        errataId,
        FeedbackType.QUESTION_ERROR,
        FeedbackStatus.PENDING,
        FeedbackStatus.PROCESSING,
      ],
    );
    return affectedOf(result);
  }

  async resolveByErrata(errataId: string, reply: string): Promise<number> {
    const result = await this.feedbackRepository
      .createQueryBuilder()
      .update(FeedbackEntity)
      .set({
        status: FeedbackStatus.RESOLVED,
        reply: () => `CASE WHEN "reply" IS NULL OR "reply" = '' THEN :reply ELSE "reply" END`,
      })
      .where('"errataId" = :errataId AND "status" IN (:...statuses)', {
        errataId,
        statuses: [FeedbackStatus.PENDING, FeedbackStatus.PROCESSING],
      })
      .setParameter('reply', reply)
      .execute();
    return result.affected ?? 0;
  }

  async anonymizeByUser(userId: number): Promise<void> {
    await this.feedbackRepository.update({ userId }, { userId: null, contact: null, images: null });
  }
}
