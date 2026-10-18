import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AiMessageEntity } from '../entities/ai-message.entity';
import { AiMessageMapper } from '../mappers/ai-message.mapper';
import {
  AiMessageInProgressError,
  AiMessageRepository,
  AiMessageResult,
  CreateAiExchangeData,
  StaleAiMessage,
} from '../../ai-message.repository';
import { AiMessage, AiMessageFeedback, AiMessageRole, AiMessageStatus } from '../../../../domain/ai-message';
import { NullableType } from '../../../../../../common/types/nullable.type';

const POSITION_OF = `(SELECT p."createdAt", p."id" FROM "ai_message" AS p WHERE p."id" = :cursorId)`;

@Injectable()
export class AiMessageRelationalRepository implements AiMessageRepository {
  constructor(
    @InjectRepository(AiMessageEntity)
    private readonly repository: Repository<AiMessageEntity>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async findById(id: string): Promise<NullableType<AiMessage>> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? AiMessageMapper.toDomain(entity) : null;
  }

  async findOwned(userId: number, id: string): Promise<NullableType<AiMessage>> {
    const entity = await this.repository
      .createQueryBuilder('m')
      .innerJoin('ai_conversation', 'c', 'c."id" = m."conversationId" AND c."userId" = :userId', { userId })
      .where('m."id" = :id', { id })
      .getOne();
    return entity ? AiMessageMapper.toDomain(entity) : null;
  }

  async findPage(
    conversationId: string,
    options: { beforeId?: string; limit: number },
  ): Promise<{ data: AiMessage[]; hasMore: boolean }> {
    const query = this.repository
      .createQueryBuilder('m')
      .where('m."conversationId" = :conversationId', { conversationId })
      .orderBy('m."createdAt"', 'DESC')
      .addOrderBy('m."id"', 'DESC')
      .take(options.limit + 1);
    if (options.beforeId) {
      query.andWhere(`(m."createdAt", m."id") < ${POSITION_OF}`, { cursorId: options.beforeId });
    }
    const entities = await query.getMany();
    const hasMore = entities.length > options.limit;
    return {
      data: entities
        .slice(0, options.limit)
        .reverse()
        .map((entity) => AiMessageMapper.toDomain(entity)),
      hasMore,
    };
  }

  async findAfter(conversationId: string, afterMessageId: string | null, limit: number): Promise<AiMessage[]> {
    const query = this.repository
      .createQueryBuilder('m')
      .where('m."conversationId" = :conversationId', { conversationId })
      .orderBy('m."createdAt"', 'DESC')
      .addOrderBy('m."id"', 'DESC')
      .take(limit);
    if (afterMessageId) {
      query.andWhere(`(m."createdAt", m."id") > ${POSITION_OF}`, { cursorId: afterMessageId });
    }
    const entities = await query.getMany();
    return entities.reverse().map((entity) => AiMessageMapper.toDomain(entity));
  }

  async findStreamingIds(conversationId: string): Promise<string[]> {
    const entities = await this.repository.find({
      select: { id: true },
      where: { conversationId, status: AiMessageStatus.STREAMING },
    });
    return entities.map((entity) => entity.id);
  }

  async findStreamingIdsByUser(userId: number): Promise<string[]> {
    const rows: { id: string }[] = await this.repository
      .createQueryBuilder('m')
      .select('m."id"', 'id')
      .innerJoin('ai_conversation', 'c', 'c."id" = m."conversationId"')
      .where('c."userId" = :userId', { userId })
      .andWhere('m."status" = :streaming', { streaming: AiMessageStatus.STREAMING })
      .getRawMany();
    return rows.map((row) => row.id);
  }

  async findStaleStreaming(createdBefore: Date, limit: number): Promise<StaleAiMessage[]> {
    const rows: { id: string; userId: number; quotaDate: string | null }[] = await this.repository
      .createQueryBuilder('m')
      .select(['m."id" AS "id"', 'c."userId" AS "userId"', 'm."quotaDate"::text AS "quotaDate"'])
      .innerJoin('ai_conversation', 'c', 'c."id" = m."conversationId"')
      .where('m."status" = :streaming', { streaming: AiMessageStatus.STREAMING })
      .andWhere(`m."createdAt" < (CAST(:createdBefore AS timestamptz) AT TIME ZONE current_setting('TimeZone'))`, {
        createdBefore,
      })
      .orderBy('m."createdAt"', 'ASC')
      .limit(limit)
      .getRawMany();
    return rows.map((row) => ({ id: row.id, userId: Number(row.userId), quotaDate: row.quotaDate }));
  }

  createExchange(data: CreateAiExchangeData): Promise<NullableType<{ user: AiMessage; assistant: AiMessage }>> {
    return this.dataSource.transaction(async (manager) => {
      const locked: unknown[] = await manager.query(`SELECT "id" FROM "ai_conversation" WHERE "id" = $1 FOR UPDATE`, [
        data.conversationId,
      ]);
      if (locked.length === 0) {
        return null;
      }
      const streaming: unknown[] = await manager.query(
        `SELECT 1 FROM "ai_message" WHERE "conversationId" = $1 AND "status" = $2 LIMIT 1`,
        [data.conversationId, AiMessageStatus.STREAMING],
      );
      if (streaming.length > 0) {
        throw new AiMessageInProgressError();
      }
      await manager.query(
        `UPDATE "ai_conversation"
         SET "title" = CASE WHEN EXISTS (SELECT 1 FROM "ai_message" WHERE "conversationId" = $1) THEN "title" ELSE $2 END,
             "updatedAt" = now()
         WHERE "id" = $1`,
        [data.conversationId, data.title],
      );
      const insert = `INSERT INTO "ai_message" ("conversationId", "role", "content", "status", "quotaDate", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, clock_timestamp(), clock_timestamp()) RETURNING "id"`;
      const [user]: { id: string }[] = await manager.query(insert, [
        data.conversationId,
        AiMessageRole.USER,
        data.content,
        AiMessageStatus.DONE,
        null,
      ]);
      const [assistant]: { id: string }[] = await manager.query(insert, [
        data.conversationId,
        AiMessageRole.ASSISTANT,
        '',
        AiMessageStatus.STREAMING,
        data.quotaDate,
      ]);
      const entities = await manager.find(AiMessageEntity, { where: { id: In([user.id, assistant.id]) } });
      const byId = new Map(entities.map((entity) => [entity.id, AiMessageMapper.toDomain(entity)]));
      return { user: byId.get(user.id)!, assistant: byId.get(assistant.id)! };
    });
  }

  async finish(id: string, result: AiMessageResult): Promise<boolean> {
    const update = await this.repository
      .createQueryBuilder()
      .update(AiMessageEntity)
      .set({
        content: result.content,
        reasoning: result.reasoning,
        suggestions: result.suggestions,
        status: result.status,
        usage: result.usage,
      })
      .where('id = :id', { id })
      .andWhere('status = :streaming', { streaming: AiMessageStatus.STREAMING })
      .execute();
    return (update.affected ?? 0) > 0;
  }

  async setFeedback(id: string, feedback: AiMessageFeedback | null): Promise<void> {
    await this.repository.update({ id }, { feedback });
  }
}
