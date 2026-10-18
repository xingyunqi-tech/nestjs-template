import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AccountCleanupEntity } from '../entities/account-cleanup.entity';
import { AccountCleanupRepository } from '../../account-cleanup.repository';

@Injectable()
export class AccountCleanupRelationalRepository implements AccountCleanupRepository {
  constructor(
    @InjectRepository(AccountCleanupEntity)
    private readonly repository: Repository<AccountCleanupEntity>,
  ) {}

  async markCompleted(userId: number): Promise<void> {
    await this.repository.query(
      `INSERT INTO "account_cleanup" ("userId", "completedAt") VALUES ($1, now())
       ON CONFLICT ("userId") DO UPDATE SET "completedAt" = EXCLUDED."completedAt"`,
      [userId],
    );
  }

  async findPendingUserIds(deletedBefore: Date, limit: number): Promise<number[]> {
    const rows: { id: number }[] = await this.repository.query(
      `SELECT u."id" FROM "user" AS u
       WHERE u."deletedAt" IS NOT NULL
         AND u."deletedAt" < (CAST($1 AS timestamptz) AT TIME ZONE current_setting('TimeZone'))
         AND NOT EXISTS (SELECT 1 FROM "account_cleanup" AS c WHERE c."userId" = u."id")
       ORDER BY u."id"
       LIMIT $2`,
      [deletedBefore, limit],
    );
    return rows.map((row) => row.id);
  }
}
