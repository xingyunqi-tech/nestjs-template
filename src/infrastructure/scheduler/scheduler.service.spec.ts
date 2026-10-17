import type { Mocked } from 'vitest';
import { SchedulerService } from './scheduler.service';
import { LockService } from '../redis/lock.service';

describe('SchedulerService.runExclusive', () => {
  let lockService: Mocked<Pick<LockService, 'tryAcquire' | 'release'>>;
  let service: SchedulerService;

  beforeEach(() => {
    lockService = { tryAcquire: vi.fn(), release: vi.fn().mockResolvedValue(undefined) };
    service = new SchedulerService(lockService as unknown as LockService);
  });

  it('should run the task while holding the lock and release it afterwards', async () => {
    lockService.tryAcquire.mockResolvedValue('token');
    const task = vi.fn().mockResolvedValue(42);

    await expect(service.runExclusive('daily-set', 60_000, task)).resolves.toEqual({ executed: true, result: 42 });
    expect(lockService.tryAcquire).toHaveBeenCalledWith('scheduler:daily-set', 60_000);
    expect(lockService.release).toHaveBeenCalledWith('scheduler:daily-set', 'token');
  });

  it('should skip the task when another instance holds the lock', async () => {
    lockService.tryAcquire.mockResolvedValue(null);
    const task = vi.fn();

    await expect(service.runExclusive('daily-set', 60_000, task)).resolves.toEqual({ executed: false });
    expect(task).not.toHaveBeenCalled();
    expect(lockService.release).not.toHaveBeenCalled();
  });

  it('should release the lock when the task fails', async () => {
    lockService.tryAcquire.mockResolvedValue('token');

    await expect(service.runExclusive('daily-set', 60_000, () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    expect(lockService.release).toHaveBeenCalledWith('scheduler:daily-set', 'token');
  });

  it('should run the task body only once when triggered concurrently', async () => {
    const held = new Set<string>();
    lockService.tryAcquire.mockImplementation(async (key) => (held.has(key) ? null : (held.add(key), 'token')));
    lockService.release.mockImplementation(async (key) => {
      held.delete(key);
    });
    let runs = 0;
    const task = async (): Promise<void> => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
    };

    const results = await Promise.all([
      service.runExclusive('stats', 60_000, task),
      service.runExclusive('stats', 60_000, task),
    ]);

    expect(runs).toBe(1);
    expect(results.filter((result) => result.executed)).toHaveLength(1);
  });
});
