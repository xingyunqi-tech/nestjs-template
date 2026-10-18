import { StudyStatsAccountCleaner } from './study-stats-account.cleaner';
import { StatsEventRepository } from './infrastructure/persistence/stats-event.repository';
import { LearningStatsService } from './learning-stats.service';

describe('StudyStatsAccountCleaner', () => {
  it('should remove the stats of the user and invalidate the knowledge cache', async () => {
    const repository = { removeUserStats: vi.fn().mockResolvedValue(undefined) };
    const learningStats = { invalidateKnowledgeCache: vi.fn().mockResolvedValue(undefined) };

    await new StudyStatsAccountCleaner(
      repository as unknown as StatsEventRepository,
      learningStats as unknown as LearningStatsService,
    ).clean(7);

    expect(repository.removeUserStats).toHaveBeenCalledWith(7);
    expect(learningStats.invalidateKnowledgeCache).toHaveBeenCalledWith(7);
  });
});
