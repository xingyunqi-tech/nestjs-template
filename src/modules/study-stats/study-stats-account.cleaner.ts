import { Injectable } from '@nestjs/common';
import { StatsEventRepository } from './infrastructure/persistence/stats-event.repository';
import { LearningStatsService } from './learning-stats.service';
import { AccountCleaner, AccountDataCleaner } from '../../infrastructure/account-cleanup/account-data-cleaner';

@AccountCleaner({ order: 40 })
@Injectable()
export class StudyStatsAccountCleaner implements AccountDataCleaner {
  readonly name = 'study-stats';

  constructor(
    private readonly statsEventRepository: StatsEventRepository,
    private readonly learningStatsService: LearningStatsService,
  ) {}

  async clean(userId: number): Promise<void> {
    await this.statsEventRepository.removeUserStats(userId);
    await this.learningStatsService.invalidateKnowledgeCache(userId);
  }
}
