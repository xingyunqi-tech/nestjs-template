import type { Mocked } from 'vitest';
import {
  DEFAULT_STATS_COMPENSATION_THRESHOLD,
  STATS_COMPENSATION_ALERT_TYPE,
  StatsCompensationTask,
} from './stats-compensation.task';
import { PendingRecordCursor, StatsEventRepository } from './infrastructure/persistence/stats-event.repository';
import { StatsEventQueue } from './stats-event.queue';
import { SchedulerService } from '../../infrastructure/scheduler/scheduler.service';
import { AppConfigService } from '../config/config.service';
import { AlertLevel, AlertReporter } from '../../infrastructure/alerting/alert-reporter';

const cursors = (count: number, offset = 0): PendingRecordCursor[] =>
  Array.from({ length: count }, (_, index) => ({ id: `r${offset + index}`, gradedAt: `t${offset + index}` }));

describe('StatsCompensationTask', () => {
  let scheduler: Mocked<Pick<SchedulerService, 'runExclusive' | 'logTaskExecution' | 'logTaskError'>>;
  let repository: Mocked<Pick<StatsEventRepository, 'findStalePendingRecords'>>;
  let queue: Mocked<Pick<StatsEventQueue, 'requeueRecord'>> & { enabled: boolean };
  let config: Mocked<Pick<AppConfigService, 'getValue'>>;
  let alerts: Mocked<AlertReporter>;
  let task: StatsCompensationTask;

  beforeEach(() => {
    scheduler = {
      runExclusive: vi.fn(async (_key, _ttl, work) => ({ executed: true as const, result: await work() })) as never,
      logTaskExecution: vi.fn(),
      logTaskError: vi.fn(),
    };
    repository = { findStalePendingRecords: vi.fn().mockResolvedValue(cursors(2)) };
    queue = { requeueRecord: vi.fn().mockResolvedValue(true), enabled: true };
    config = { getValue: vi.fn().mockResolvedValue(undefined) };
    alerts = { raise: vi.fn().mockResolvedValue(null) };
    task = new StatsCompensationTask(
      scheduler as unknown as SchedulerService,
      repository as unknown as StatsEventRepository,
      queue as unknown as StatsEventQueue,
      config as unknown as AppConfigService,
      alerts,
    );
  });

  it('should requeue records graded over 10 minutes ago and still unapplied under runExclusive', async () => {
    const now = new Date('2026-10-17T10:00:00Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });
    try {
      await task.handle();
    } finally {
      vi.useRealTimers();
    }

    expect(scheduler.runExclusive).toHaveBeenCalledWith('stats-compensation', expect.any(Number), expect.any(Function));
    const [gradedBefore, after, , userIds] = repository.findStalePendingRecords.mock.calls[0];
    expect(gradedBefore).toEqual(new Date('2026-10-17T09:50:00Z'));
    expect(after).toBeNull();
    expect(userIds).toBeUndefined();
    expect(queue.requeueRecord.mock.calls.map(([id]) => id)).toEqual(['r0', 'r1']);
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('should scan in batches by cursor', async () => {
    repository.findStalePendingRecords.mockResolvedValueOnce(cursors(200)).mockResolvedValueOnce(cursors(3, 200));

    await expect(task.requeueStale(new Date())).resolves.toBe(203);

    expect(repository.findStalePendingRecords.mock.calls[1][1]).toEqual({ id: 'r199', gradedAt: 't199' });
  });

  it('should raise an alert when requeued records exceed the default threshold', async () => {
    const total = DEFAULT_STATS_COMPENSATION_THRESHOLD + 1;
    repository.findStalePendingRecords.mockResolvedValueOnce(cursors(total));

    await task.requeueStale(new Date());

    expect(alerts.raise).toHaveBeenCalledWith(STATS_COMPENSATION_ALERT_TYPE, AlertLevel.WARN, expect.any(String), {
      requeued: total,
      threshold: DEFAULT_STATS_COMPENSATION_THRESHOLD,
    });
  });

  it('should read the threshold from alert.thresholds', async () => {
    config.getValue.mockResolvedValue({ statsCompensation: 1 });

    await task.requeueStale(new Date());

    expect(config.getValue).toHaveBeenCalledWith('alert.thresholds');
    expect(alerts.raise).toHaveBeenCalledWith(STATS_COMPENSATION_ALERT_TYPE, AlertLevel.WARN, expect.any(String), {
      requeued: 2,
      threshold: 1,
    });
  });

  it('should count and alert only on records actually enqueued', async () => {
    repository.findStalePendingRecords.mockResolvedValueOnce(cursors(DEFAULT_STATS_COMPENSATION_THRESHOLD + 5));
    queue.requeueRecord.mockImplementation((id) => Promise.resolve(Number(id.slice(1)) < 3));

    await expect(task.requeueStale(new Date())).resolves.toBe(3);

    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('should limit the scan to the given users', async () => {
    await task.requeueStale(new Date(), [7]);

    expect(repository.findStalePendingRecords.mock.calls[0][3]).toEqual([7]);
  });

  it('should neither scan nor alert when the queue is unavailable', async () => {
    queue.enabled = false;

    await expect(task.requeueStale(new Date())).resolves.toBe(0);

    expect(repository.findStalePendingRecords).not.toHaveBeenCalled();
    expect(alerts.raise).not.toHaveBeenCalled();
  });

  it('should log failures without throwing', async () => {
    repository.findStalePendingRecords.mockRejectedValue(new Error('db down'));

    await expect(task.handle()).resolves.toBeUndefined();

    expect(scheduler.logTaskError).toHaveBeenCalled();
  });
});
