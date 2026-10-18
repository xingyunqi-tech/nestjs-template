import { PracticeAccountCleaner } from './practice-account.cleaner';
import { PracticeSessionRepository } from './infrastructure/persistence/practice-session.repository';
import { MockSubmitScheduler } from './mock-submit.scheduler';

describe('PracticeAccountCleaner', () => {
  it('should cancel the auto submit of in-progress mocks before removing the sessions', async () => {
    const calls: string[] = [];
    const repository = {
      findInProgressMockIds: vi.fn().mockResolvedValue(['s1', 's2']),
      removeByUser: vi.fn(() => {
        calls.push('remove');
        return Promise.resolve();
      }),
    };
    const scheduler = {
      cancel: vi.fn(() => {
        calls.push('cancel');
        return Promise.resolve();
      }),
    };
    const cleaner = new PracticeAccountCleaner(
      repository as unknown as PracticeSessionRepository,
      scheduler as unknown as MockSubmitScheduler,
    );

    await cleaner.clean(7);

    expect(repository.findInProgressMockIds).toHaveBeenCalledWith(7);
    expect(scheduler.cancel).toHaveBeenCalledWith(['s1', 's2']);
    expect(repository.removeByUser).toHaveBeenCalledWith(7);
    expect(calls).toEqual(['cancel', 'remove']);
  });
});
