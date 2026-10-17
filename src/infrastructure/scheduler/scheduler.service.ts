import { Injectable, Logger } from '@nestjs/common';
import { LockService } from '../redis/lock.service';

export type ExclusiveRunResult<T> = { executed: true; result: T } | { executed: false };

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(private readonly lockService: LockService) {}

  onModuleInit(): void {
    this.logger.log('Scheduler service initialized');
  }

  logTaskExecution(taskName: string, message: string): void {
    this.logger.log(`[${taskName}] ${message}`);
  }

  logTaskError(taskName: string, error: Error): void {
    this.logger.error(`[${taskName}] Task failed: ${error.message}`, error.stack);
  }

  /** task 自身须以条件更新保证幂等 */
  async runExclusive<T>(key: string, ttlMs: number, task: () => Promise<T>): Promise<ExclusiveRunResult<T>> {
    const lockKey = `scheduler:${key}`;
    const token = await this.lockService.tryAcquire(lockKey, ttlMs);
    if (!token) {
      this.logger.debug(`[${key}] Skipped: running on another instance`);
      return { executed: false };
    }

    try {
      return { executed: true, result: await task() };
    } finally {
      await this.lockService.release(lockKey, token);
    }
  }
}
