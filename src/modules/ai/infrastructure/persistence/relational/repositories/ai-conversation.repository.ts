import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AiConversationEntity } from '../entities/ai-conversation.entity';
import { AiConversationMapper } from '../mappers/ai-conversation.mapper';
import { AiConversationRepository, CreateAiConversationData } from '../../ai-conversation.repository';
import { AiConversation } from '../../../../domain/ai-conversation';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';

@Injectable()
export class AiConversationRelationalRepository implements AiConversationRepository {
  constructor(
    @InjectRepository(AiConversationEntity)
    private readonly repository: Repository<AiConversationEntity>,
  ) {}

  async findOrCreate(data: CreateAiConversationData): Promise<AiConversation> {
    await this.repository.query(
      `INSERT INTO "ai_conversation" ("userId", "title", "contextType", "contextId", "contextVersion")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("userId", "contextType", "contextId", "contextVersion") WHERE "contextId" IS NOT NULL DO NOTHING`,
      [data.userId, data.title, data.contextType, data.contextId, data.contextVersion],
    );
    const entity = await this.repository.findOneOrFail({
      where: {
        userId: data.userId,
        contextType: data.contextType,
        contextId: data.contextId ?? IsNull(),
        contextVersion: data.contextVersion ?? IsNull(),
      },
      order: { createdAt: 'ASC' },
    });
    return AiConversationMapper.toDomain(entity);
  }

  async findById(id: string): Promise<NullableType<AiConversation>> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? AiConversationMapper.toDomain(entity) : null;
  }

  async findManyByUser(
    userId: number,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: AiConversation[]; total: number }> {
    const [entities, total] = await this.repository.findAndCount({
      where: { userId },
      order: { updatedAt: 'DESC', id: 'DESC' },
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
    });
    return { data: entities.map((entity) => AiConversationMapper.toDomain(entity)), total };
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete({ id });
  }

  async updateSummary(
    id: string,
    expectedUpToMessageId: string | null,
    summary: string,
    upToMessageId: string,
  ): Promise<boolean> {
    const query = this.repository
      .createQueryBuilder()
      .update(AiConversationEntity)
      .set({ summary, summaryUpToMessageId: upToMessageId, updatedAt: () => '"updatedAt"' })
      .where('id = :id', { id });
    if (expectedUpToMessageId === null) {
      query.andWhere('"summaryUpToMessageId" IS NULL');
    } else {
      query.andWhere('"summaryUpToMessageId" = :expected', { expected: expectedUpToMessageId });
    }
    const result = await query.execute();
    return (result.affected ?? 0) > 0;
  }
}
