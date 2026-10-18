import { DelayedError, Job } from 'bullmq';
import { MockSubmitQueueProcessor } from './mock-submit-queue.processor';
import { MockSubmitJobData } from './mock-submit-queue.constants';
import { MockExamService } from '../../../modules/practice/mock-exam.service';

describe('MockSubmitQueueProcessor', () => {
  const job = (): Job<MockSubmitJobData> =>
    ({
      data: { sessionId: 's1' },
      moveToDelayed: vi.fn().mockResolvedValue(undefined),
    }) as unknown as Job<MockSubmitJobData>;

  it('should auto submit the session of the job', async () => {
    const autoSubmit = vi.fn().mockResolvedValue(null);
    const processor = new MockSubmitQueueProcessor({ autoSubmit } as unknown as MockExamService);
    const current = job();

    await processor.process(current, 'token');

    expect(autoSubmit).toHaveBeenCalledWith('s1');
    expect(current.moveToDelayed).not.toHaveBeenCalled();
  });

  it('should delay the same job until the auto submit time when triggered early', async () => {
    const dueAt = new Date(Date.now() + 30_000);
    const processor = new MockSubmitQueueProcessor({
      autoSubmit: vi.fn().mockResolvedValue(dueAt),
    } as unknown as MockExamService);
    const current = job();

    await expect(processor.process(current, 'token')).rejects.toBeInstanceOf(DelayedError);

    expect(current.moveToDelayed).toHaveBeenCalledWith(dueAt.getTime(), 'token');
  });
});
