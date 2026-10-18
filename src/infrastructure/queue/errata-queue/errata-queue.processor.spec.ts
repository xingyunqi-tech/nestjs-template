import { DelayedError, Job } from 'bullmq';
import { ErrataQueueProcessor } from './errata-queue.processor';
import { ErrataJobData } from './errata-queue.constants';
import { ErrataService } from '../../../modules/errata/errata.service';

describe('ErrataQueueProcessor', () => {
  const job = (attemptsMade: number): Job<ErrataJobData> =>
    ({
      data: { errataId: 'e1' },
      attemptsMade,
      opts: { attempts: 3 },
      moveToDelayed: vi.fn().mockResolvedValue(undefined),
    }) as unknown as Job<ErrataJobData>;

  const service = (execute: () => Promise<unknown>) => ({
    execute: vi.fn(execute),
    markFailed: vi.fn().mockResolvedValue(undefined),
  });

  it('should execute the errata of the job', async () => {
    const errata = service(() => Promise.resolve({ status: 'skipped' }));

    await new ErrataQueueProcessor(errata as unknown as ErrataService).process(job(0));

    expect(errata.execute).toHaveBeenCalledWith('e1');
  });

  it('should rethrow for a retry before the last attempt', async () => {
    const errata = service(() => Promise.reject(new Error('busy')));

    await expect(new ErrataQueueProcessor(errata as unknown as ErrataService).process(job(1))).rejects.toThrow('busy');
    expect(errata.markFailed).not.toHaveBeenCalled();
  });

  it('should mark the errata failed on the last attempt', async () => {
    const error = new Error('busy');
    const errata = service(() => Promise.reject(error));

    await expect(new ErrataQueueProcessor(errata as unknown as ErrataService).process(job(2))).rejects.toThrow('busy');
    expect(errata.markFailed).toHaveBeenCalledWith('e1', error);
  });

  it('should delay the same job without counting a failure when users are skipped', async () => {
    const errata = service(() => Promise.resolve({ status: 'deferred' }));
    const current = job(0);
    const before = Date.now();

    await expect(
      new ErrataQueueProcessor(errata as unknown as ErrataService).process(current, 't'),
    ).rejects.toBeInstanceOf(DelayedError);
    const [delayUntil, token] = vi.mocked(current.moveToDelayed).mock.calls[0];
    expect(delayUntil).toBeGreaterThan(before);
    expect(token).toBe('t');
    expect(errata.markFailed).not.toHaveBeenCalled();
  });
});
