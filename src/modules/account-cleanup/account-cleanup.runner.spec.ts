import type { Mocked } from 'vitest';
import { DiscoveryService } from '@nestjs/core';
import { AccountCleanupError, AccountCleanupRunner } from './account-cleanup.runner';
import { AccountCleanupRepository } from './infrastructure/persistence/account-cleanup.repository';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';
import {
  AccountCleanupProducer,
  InProcessCleanupRunner,
} from '../../infrastructure/account-cleanup/account-cleanup.producer';
import { ACCOUNT_CLEANUP_FAILED_ALERT } from '../../infrastructure/account-cleanup/account-cleanup-alert';
import { AlertLevel, AlertReporter } from '../../infrastructure/alerting/alert-reporter';

describe('AccountCleanupRunner', () => {
  let calls: string[];
  let repository: Mocked<AccountCleanupRepository>;
  let producer: { setInProcessRunner: ReturnType<typeof vi.fn> };
  let alertReporter: Mocked<AlertReporter>;

  const cleaner = (name: string, clean: () => Promise<void> = () => Promise.resolve()): AccountDataCleaner => ({
    name,
    clean: vi.fn((userId: number) => {
      calls.push(`${name}:${userId}`);
      return clean();
    }),
  });

  const create = (registered: { order: number; cleaner: AccountDataCleaner }[]): AccountCleanupRunner => {
    const wrappers = registered.map(({ order, cleaner: instance }) => ({ instance, order }));
    const discovery = {
      getProviders: vi.fn(() => [...wrappers, wrappers[0]].filter(Boolean)),
      getMetadataByDecorator: vi.fn((decorator: unknown, wrapper: { order: number }) => {
        expect(decorator).toBe(AccountCleaner);
        return { order: wrapper.order };
      }),
    };
    const runner = new AccountCleanupRunner(
      discovery as unknown as DiscoveryService,
      repository,
      producer as unknown as AccountCleanupProducer,
      alertReporter,
    );
    runner.onModuleInit();
    return runner;
  };

  beforeEach(() => {
    calls = [];
    repository = { markCompleted: vi.fn().mockResolvedValue(undefined), findPendingUserIds: vi.fn() };
    producer = { setInProcessRunner: vi.fn() };
    alertReporter = { raise: vi.fn().mockResolvedValue(null) };
  });

  it('should run the discovered cleaners once each by order and record the completion', async () => {
    const runner = create([
      { order: 1000, cleaner: cleaner('files') },
      { order: 10, cleaner: cleaner('practice') },
      { order: 20, cleaner: cleaner('papers') },
    ]);

    await runner.run(7);

    expect(runner.cleanerNames).toEqual(['practice', 'papers', 'files']);
    expect(calls).toEqual(['practice:7', 'papers:7', 'files:7']);
    expect(repository.markCompleted).toHaveBeenCalledWith(7);
  });

  it('should keep running the remaining cleaners and then throw with the failed ones', async () => {
    const runner = create([
      { order: 10, cleaner: cleaner('practice') },
      { order: 20, cleaner: cleaner('papers', () => Promise.reject(new Error('busy'))) },
      { order: 30, cleaner: cleaner('files') },
    ]);

    const error = await runner.run(7).catch((e: unknown) => e);

    expect(calls).toEqual(['practice:7', 'papers:7', 'files:7']);
    expect(error).toBeInstanceOf(AccountCleanupError);
    expect((error as AccountCleanupError).failedCleaners).toEqual(['papers']);
    expect((error as Error).message).toContain('papers (busy)');
    expect(repository.markCompleted).not.toHaveBeenCalled();
  });

  it('should raise a deduplicated alert with the failed cleaners', async () => {
    const runner = create([]);

    await runner.reportFailure(7, new AccountCleanupError(7, ['files'], [new Error('s3 down')]));

    expect(alertReporter.raise).toHaveBeenCalledWith(
      ACCOUNT_CLEANUP_FAILED_ALERT,
      AlertLevel.WARN,
      expect.stringContaining('用户 7'),
      expect.objectContaining({ userId: 7, failedCleaners: ['files'] }),
      `${ACCOUNT_CLEANUP_FAILED_ALERT}:7`,
    );
  });

  it('should not throw when raising the alert fails', async () => {
    alertReporter.raise.mockRejectedValue(new Error('db down'));

    await expect(create([]).reportFailure(7, new Error('boom'))).resolves.toBeUndefined();
  });

  it('should register an in-process runner that reports failures', async () => {
    create([{ order: 10, cleaner: cleaner('practice', () => Promise.reject(new Error('busy'))) }]);
    const inProcess = producer.setInProcessRunner.mock.calls[0][0] as InProcessCleanupRunner;

    await inProcess(7);

    expect(alertReporter.raise).toHaveBeenCalledWith(
      ACCOUNT_CLEANUP_FAILED_ALERT,
      AlertLevel.WARN,
      expect.any(String),
      expect.objectContaining({ failedCleaners: ['practice'] }),
      `${ACCOUNT_CLEANUP_FAILED_ALERT}:7`,
    );
  });
});
