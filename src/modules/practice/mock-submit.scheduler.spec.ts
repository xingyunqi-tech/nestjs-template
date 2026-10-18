import { Queue } from 'bullmq';
import { MockSubmitScheduler } from './mock-submit.scheduler';
import { MockSubmitJobData } from '../../infrastructure/queue/mock-submit-queue/mock-submit-queue.constants';

describe('MockSubmitScheduler', () => {
  it('should remove the auto submit job of each session', async () => {
    const queue = { remove: vi.fn().mockResolvedValue(1) };

    await new MockSubmitScheduler(queue as unknown as Queue<MockSubmitJobData>).cancel(['s1', 's2']);

    expect(queue.remove).toHaveBeenNthCalledWith(1, 's1');
    expect(queue.remove).toHaveBeenNthCalledWith(2, 's2');
  });

  it('should do nothing without a queue', async () => {
    await expect(new MockSubmitScheduler().cancel(['s1'])).resolves.toBeUndefined();
  });
});
