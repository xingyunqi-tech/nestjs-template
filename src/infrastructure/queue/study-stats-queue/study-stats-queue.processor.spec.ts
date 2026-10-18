import { DelayedError, Job } from 'bullmq';
import { StudyStatsQueueProcessor } from './study-stats-queue.processor';
import { StudyStatsJobData } from './study-stats-queue.constants';
import { StatsEventService } from '../../../modules/study-stats/stats-event.service';

describe('StudyStatsQueueProcessor', () => {
  const job = (data: StudyStatsJobData): Job<StudyStatsJobData> =>
    ({ data, moveToDelayed: vi.fn().mockResolvedValue(undefined) }) as unknown as Job<StudyStatsJobData>;

  const service = (result: 'done' | 'locked' = 'done') => ({
    processRecord: vi.fn().mockResolvedValue(result),
    processSession: vi.fn().mockResolvedValue(result),
  });

  it('should process record jobs by record', async () => {
    const stats = service();
    await new StudyStatsQueueProcessor(stats as unknown as StatsEventService).process(job({ recordId: 'r1' }), 't');

    expect(stats.processRecord).toHaveBeenCalledWith('r1');
    expect(stats.processSession).not.toHaveBeenCalled();
  });

  it('should process session jobs by session', async () => {
    const stats = service();
    await new StudyStatsQueueProcessor(stats as unknown as StatsEventService).process(job({ sessionId: 's1' }), 't');

    expect(stats.processSession).toHaveBeenCalledWith('s1');
  });

  it('should delay the same job when the user lock is taken', async () => {
    const current = job({ recordId: 'r1' });
    const before = Date.now();
    const processor = new StudyStatsQueueProcessor(service('locked') as unknown as StatsEventService);

    await expect(processor.process(current, 't')).rejects.toBeInstanceOf(DelayedError);

    const [delayUntil, token] = vi.mocked(current.moveToDelayed).mock.calls[0];
    expect(delayUntil).toBeGreaterThan(before);
    expect(token).toBe('t');
  });
});
