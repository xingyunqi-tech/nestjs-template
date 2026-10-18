import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';
import { AccountCleanupProducer } from '../../infrastructure/account-cleanup/account-cleanup.producer';
import { raiseAccountCleanupFailure } from '../../infrastructure/account-cleanup/account-cleanup-alert';
import { AlertReporter } from '../../infrastructure/alerting/alert-reporter';
import { AccountCleanupRepository } from './infrastructure/persistence/account-cleanup.repository';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class AccountCleanupError extends Error {
  constructor(
    readonly userId: number,
    readonly failedCleaners: string[],
    readonly causes: unknown[],
  ) {
    super(
      `Account cleanup for user ${userId} failed: ${failedCleaners
        .map((name, index) => `${name} (${messageOf(causes[index])})`)
        .join(', ')}`,
    );
  }
}

/** 按 order 依次执行全部清理器，单个失败不影响其余清理器，全部执行后汇总抛出；全部成功时记录完成时间 */
@Injectable()
export class AccountCleanupRunner implements OnModuleInit {
  private readonly logger = new Logger(AccountCleanupRunner.name);
  private cleaners: AccountDataCleaner[] = [];

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly repository: AccountCleanupRepository,
    private readonly producer: AccountCleanupProducer,
    @Optional() private readonly alertReporter?: AlertReporter,
  ) {}

  onModuleInit(): void {
    const seen = new Set<unknown>();
    this.cleaners = this.discoveryService
      .getProviders({ metadataKey: AccountCleaner.KEY })
      .filter((wrapper) => wrapper.instance && !seen.has(wrapper.instance) && seen.add(wrapper.instance))
      .map((wrapper) => ({
        order: this.discoveryService.getMetadataByDecorator(AccountCleaner, wrapper)?.order ?? 0,
        cleaner: wrapper.instance as AccountDataCleaner,
      }))
      .sort((a, b) => a.order - b.order)
      .map(({ cleaner }) => cleaner);
    this.producer.setInProcessRunner((userId) =>
      this.run(userId).catch((error: unknown) => this.reportFailure(userId, error)),
    );
  }

  get cleanerNames(): string[] {
    return this.cleaners.map((cleaner) => cleaner.name);
  }

  async run(userId: number): Promise<void> {
    const failed: string[] = [];
    const causes: unknown[] = [];
    for (const cleaner of this.cleaners) {
      try {
        await cleaner.clean(userId);
      } catch (error) {
        failed.push(cleaner.name);
        causes.push(error);
        this.logger.error(
          `Cleaner ${cleaner.name} failed for user ${userId}: ${messageOf(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
    if (failed.length > 0) {
      throw new AccountCleanupError(userId, failed, causes);
    }
    await this.repository.markCompleted(userId);
    this.logger.log(`Account data of user ${userId} cleaned`);
  }

  reportFailure(userId: number, error: unknown): Promise<void> {
    return raiseAccountCleanupFailure(
      this.alertReporter,
      this.logger,
      userId,
      error,
      error instanceof AccountCleanupError ? error.failedCleaners : undefined,
    );
  }
}
