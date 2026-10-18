import { Queue } from 'bullmq';
import { StatsEventQueue } from './stats-event.queue';
import {
  StudyStatsJobData,
  StudyStatsJobName,
} from '../../infrastructure/queue/study-stats-queue/study-stats-queue.constants';

describe('StatsEventQueue', () => {
  const createQueue = (existing: { getState: () => Promise<string>; remove: () => Promise<void> } | null = null) =>
    ({
      add: vi.fn().mockResolvedValue(undefined),
      getJob: vi.fn().mockResolvedValue(existing),
    }) as unknown as Queue<StudyStatsJobData> & { add: ReturnType<typeof vi.fn> };

  it('should enqueue a record job with the record id as job id', async () => {
    const queue = createQueue();
    await new StatsEventQueue(queue).publishRecord('r1');

    expect(queue.add).toHaveBeenCalledWith(
      StudyStatsJobName.RECORD,
      { recordId: 'r1' },
      expect.objectContaining({ jobId: 'r1' }),
    );
  });

  it('should enqueue one job per session', async () => {
    const queue = createQueue();
    await new StatsEventQueue(queue).publishSession('s1');

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      StudyStatsJobName.SESSION,
      { sessionId: 's1' },
      expect.objectContaining({ jobId: 'session-s1' }),
    );
  });

  it('should enqueue one check-in job per user and date', async () => {
    const queue = createQueue();
    await new StatsEventQueue(queue).publishCheckIn(7, '2026-10-17');

    expect(queue.add).toHaveBeenCalledWith(
      StudyStatsJobName.CHECK_IN,
      { userId: 7, date: '2026-10-17' },
      expect.objectContaining({ jobId: 'checkin-7-2026-10-17' }),
    );
  });

  it('should do nothing when the queue is not registered', async () => {
    const publisher = new StatsEventQueue();

    await expect(publisher.publishRecord('r1')).resolves.toBeUndefined();
    await expect(publisher.requeueRecord('r1')).resolves.toBe(false);
    expect(publisher.enabled).toBe(false);
  });

  it('should remove a finished job with the same id before requeueing', async () => {
    const existing = { getState: vi.fn().mockResolvedValue('failed'), remove: vi.fn().mockResolvedValue(undefined) };
    const queue = createQueue(existing);

    await expect(new StatsEventQueue(queue).requeueRecord('r1')).resolves.toBe(true);

    expect(existing.remove).toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith(StudyStatsJobName.RECORD, { recordId: 'r1' }, expect.anything());
  });

  it('should not requeue while a job with the same id is pending', async () => {
    const existing = { getState: vi.fn().mockResolvedValue('delayed'), remove: vi.fn() };
    const queue = createQueue(existing);

    await expect(new StatsEventQueue(queue).requeueRecord('r1')).resolves.toBe(false);

    expect(existing.remove).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('should requeue directly when the job with the same id is in an unknown state', async () => {
    const existing = { getState: vi.fn().mockResolvedValue('unknown'), remove: vi.fn() };
    const queue = createQueue(existing);

    await expect(new StatsEventQueue(queue).requeueRecord('r1')).resolves.toBe(true);

    expect(existing.remove).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});
