import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { ErrataEntity } from '../entities/errata.entity';
import { ErrataMapper } from '../mappers/errata.mapper';
import { CreateErrataData, ErrataConflictError, ErrataFilter, ErrataRepository } from '../../errata.repository';
import { ACTIVE_ERRATA_STATUSES, Errata, ErrataStatus } from '../../../../domain/errata';
import { NullableType } from '../../../../../../common/types/nullable.type';
import { IPaginationOptions } from '../../../../../../common/types/pagination-options';
import {
  TransactionHandle,
  createTransactionHandle,
  entityManagerOf,
} from '../../../../../../common/database/transaction-handle';

const DEADLOCK_DETECTED = '40P01';
const UNIQUE_VIOLATION = '23505';
const ACTIVE_UNIQUE_INDEX = 'UQ_errata_questionId_active';
const MAX_TRANSACTION_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 20;
const FAILURE_REASON_MAX_LENGTH = 500;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function driverErrorOf(error: unknown): { code?: string; constraint?: string } | null {
  return error instanceof QueryFailedError ? (error.driverError as { code?: string; constraint?: string }) : null;
}

function isActiveConflict(error: unknown): boolean {
  const driverError = driverErrorOf(error);
  return driverError?.code === UNIQUE_VIOLATION && driverError.constraint === ACTIVE_UNIQUE_INDEX;
}

@Injectable()
export class ErrataRelationalRepository implements ErrataRepository {
  constructor(
    @InjectRepository(ErrataEntity)
    private readonly repository: Repository<ErrataEntity>,
  ) {}

  async insert(handle: TransactionHandle, data: CreateErrataData): Promise<Errata> {
    const manager = entityManagerOf(handle);
    try {
      const entity = await manager.save(manager.create(ErrataEntity, ErrataMapper.toPersistence(data)));
      return ErrataMapper.toDomain(await manager.findOneByOrFail(ErrataEntity, { id: entity.id }));
    } catch (error) {
      throw isActiveConflict(error) ? new ErrataConflictError() : error;
    }
  }

  async findById(id: string): Promise<NullableType<Errata>> {
    const entity = await this.repository.findOneBy({ id });
    return entity ? ErrataMapper.toDomain(entity) : null;
  }

  async findActiveByQuestion(questionId: string): Promise<NullableType<Errata>> {
    const entity = await this.repository.findOneBy({ questionId, status: In(ACTIVE_ERRATA_STATUSES) });
    return entity ? ErrataMapper.toDomain(entity) : null;
  }

  async findManyWithPaginationAndCount(
    filter: ErrataFilter,
    paginationOptions: IPaginationOptions,
  ): Promise<{ data: Errata[]; total: number }> {
    const [entities, total] = await this.repository.findAndCount({
      where: {
        ...(filter.status && { status: filter.status }),
        ...(filter.questionId && { questionId: filter.questionId }),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: (paginationOptions.page - 1) * paginationOptions.limit,
      take: paginationOptions.limit,
    });
    return { data: entities.map((entity) => ErrataMapper.toDomain(entity)), total };
  }

  async findStaleActive(staleMs: number, limit: number): Promise<Errata[]> {
    const entities = await this.repository
      .createQueryBuilder('e')
      .where('e.status IN (:...statuses)', { statuses: ACTIVE_ERRATA_STATUSES })
      .andWhere(`e."updatedAt" < now() - make_interval(secs => :seconds)`, { seconds: staleMs / 1000 })
      .orderBy('e.updatedAt', 'ASC')
      .addOrderBy('e.id', 'ASC')
      .take(limit)
      .getMany();
    return entities.map((entity) => ErrataMapper.toDomain(entity));
  }

  async isStaleActive(id: string, staleMs: number): Promise<boolean> {
    const count = await this.repository
      .createQueryBuilder('e')
      .where('e.id = :id AND e.status IN (:...statuses)', { id, statuses: ACTIVE_ERRATA_STATUSES })
      .andWhere(`e."updatedAt" < now() - make_interval(secs => :seconds)`, { seconds: staleMs / 1000 })
      .getCount();
    return count > 0;
  }

  async start(id: string): Promise<NullableType<Errata>> {
    const result = await this.repository
      .createQueryBuilder()
      .update(ErrataEntity)
      .set({ status: ErrataStatus.RUNNING, startedAt: () => 'COALESCE("startedAt", now())', failureReason: null })
      .where('id = :id AND status IN (:...statuses)', { id, statuses: ACTIVE_ERRATA_STATUSES })
      .execute();
    return (result.affected ?? 0) > 0 ? this.findById(id) : null;
  }

  async setAffectedUsers(id: string, affectedUsers: number): Promise<void> {
    await this.repository.update({ id }, { affectedUsers });
  }

  async touch(id: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(ErrataEntity)
      .set({ updatedAt: () => 'now()' })
      .where('id = :id', { id })
      .execute();
  }

  async markUserProcessed(handle: TransactionHandle, id: string, userId: number): Promise<void> {
    const manager = entityManagerOf(handle);
    const inserted: unknown[] = await manager.query(
      `INSERT INTO "errata_user" ("errataId", "userId") VALUES ($1, $2)
       ON CONFLICT ("errataId", "userId") DO NOTHING
       RETURNING "userId"`,
      [id, userId],
    );
    if (inserted.length > 0) {
      await manager.query(
        `UPDATE "errata" SET "processedUsers" = "processedUsers" + 1, "updatedAt" = now() WHERE "id" = $1`,
        [id],
      );
    }
  }

  async claimNoticeUsers(
    handle: TransactionHandle,
    id: string,
    limit: number,
  ): Promise<{ claimed: number; activeUserIds: number[] }> {
    const rows: { userId: number; active: boolean }[] = await entityManagerOf(handle).query(
      `WITH claimed AS (
         UPDATE "errata_user" SET "notified" = true
         WHERE "errataId" = $1 AND NOT "notified" AND "userId" IN (
           SELECT "userId" FROM "errata_user" WHERE "errataId" = $1 AND NOT "notified"
           ORDER BY "userId" LIMIT $2 FOR UPDATE SKIP LOCKED
         )
         RETURNING "userId"
       )
       SELECT c."userId", (u."id" IS NOT NULL) AS "active"
       FROM claimed AS c
       LEFT JOIN "user" AS u ON u."id" = c."userId" AND u."deletedAt" IS NULL`,
      [id, limit],
    );
    return {
      claimed: rows.length,
      activeUserIds: rows
        .filter((row) => row.active)
        .map((row) => row.userId)
        .sort((a, b) => a - b),
    };
  }

  async finish(id: string): Promise<NullableType<Errata>> {
    await this.repository
      .createQueryBuilder()
      .update(ErrataEntity)
      .set({ status: ErrataStatus.DONE, finishedAt: () => 'now()' })
      .where('id = :id AND status = :running', { id, running: ErrataStatus.RUNNING })
      .execute();
    return this.findById(id);
  }

  async fail(id: string, reason: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(ErrataEntity)
      .set({ status: ErrataStatus.FAILED, failureReason: reason.slice(0, FAILURE_REASON_MAX_LENGTH) })
      .where('id = :id AND status IN (:...statuses)', { id, statuses: ACTIVE_ERRATA_STATUSES })
      .execute();
  }

  async reopen(id: string): Promise<boolean> {
    try {
      const result = await this.repository
        .createQueryBuilder()
        .update(ErrataEntity)
        .set({ status: ErrataStatus.PENDING, failureReason: null })
        .where('id = :id AND status = :failed', { id, failed: ErrataStatus.FAILED })
        .execute();
      return (result.affected ?? 0) > 0;
    } catch (error) {
      throw isActiveConflict(error) ? new ErrataConflictError() : error;
    }
  }

  async transaction<T>(work: (handle: TransactionHandle) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.repository.manager.transaction((manager) => work(createTransactionHandle(manager)));
      } catch (error) {
        if (driverErrorOf(error)?.code !== DEADLOCK_DETECTED || attempt >= MAX_TRANSACTION_ATTEMPTS) {
          throw error;
        }
        await sleep(RETRY_BACKOFF_MS * attempt + Math.floor(Math.random() * RETRY_BACKOFF_MS));
      }
    }
  }

  async removeUserLinks(userId: number): Promise<void> {
    await this.repository.query(`DELETE FROM "errata_user" WHERE "userId" = $1`, [userId]);
  }
}
