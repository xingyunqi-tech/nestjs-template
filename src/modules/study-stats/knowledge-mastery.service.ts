import { Inject, Injectable } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { randomUUID } from 'crypto';
import {
  LearningStatsRepository,
  SubtreeAnswerAggregate,
  SubtreeQuestionCount,
} from './infrastructure/persistence/learning-stats.repository';
import { KnowledgePointProgress, WeakPoint } from './domain/knowledge-point-progress';
import { isWeak, masteryOf, masteryOfResults } from './domain/mastery';

const CACHE_TTL_MS = 10 * 60_000;
const VERSION_TTL_MS = 24 * 60 * 60_000;

export const knowledgeVersionKey = (userId: number): string => `study:knowledge:version:${userId}`;
export const knowledgeAnswersKey = (userId: number, subjectId: string, version: string): string =>
  `study:knowledge:${userId}:${subjectId}:${version}`;
export const subjectQuestionCountsKey = (subjectId: string): string => `study:knowledge:questions:${subjectId}`;

@Injectable()
export class KnowledgeMasteryService {
  constructor(
    private readonly repository: LearningStatsRepository,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  /** 知识点树的个人进度：叶子与父节点同样按子树作答记录聚合；作答聚合按用户、题目数按科目各缓存 10 分钟 */
  async findProgress(userId: number, subjectId: string): Promise<Map<string, KnowledgePointProgress>> {
    const [answers, questionCounts] = await Promise.all([
      this.findAnswerAggregates(userId, subjectId),
      this.findQuestionCounts(subjectId),
    ]);
    const progress = new Map<string, KnowledgePointProgress>();
    for (const item of questionCounts) {
      progress.set(item.knowledgePointId, {
        answeredQuestionCount: 0,
        questionCount: item.questionCount,
        answered: 0,
        correct: 0,
        mastery: null,
      });
    }
    for (const item of answers) {
      const questionCount = progress.get(item.knowledgePointId)?.questionCount ?? 0;
      progress.set(item.knowledgePointId, {
        answeredQuestionCount: Math.min(item.answeredQuestionCount, questionCount),
        questionCount,
        answered: item.answered,
        correct: item.correct,
        mastery: masteryOf(item),
      });
    }
    return progress;
  }

  /** 按 user_knowledge_stat 实时数据：作答 ≥ 5 次且掌握度 < 60% 的叶子，按掌握度升序 */
  async findWeakPoints(userId: number, subjectId: string): Promise<WeakPoint[]> {
    const stats = await this.repository.findLeafStats(userId, subjectId);
    return stats
      .flatMap((stat): WeakPoint[] => {
        const mastery = masteryOfResults(stat.answered, stat.correct, stat.recentResults);
        return isWeak(stat.answered, mastery)
          ? [{ knowledgePointId: stat.knowledgePointId, answered: stat.answered, correct: stat.correct, mastery }]
          : [];
      })
      .sort(
        (a, b) =>
          a.mastery - b.mastery || b.answered - a.answered || a.knowledgePointId.localeCompare(b.knowledgePointId),
      );
  }

  async findWeakKnowledgePointIds(userId: number, subjectId: string): Promise<string[]> {
    return (await this.findWeakPoints(userId, subjectId)).map((item) => item.knowledgePointId);
  }

  async invalidate(userId: number): Promise<void> {
    await this.cacheManager.set(knowledgeVersionKey(userId), randomUUID(), VERSION_TTL_MS);
  }

  private async findAnswerAggregates(userId: number, subjectId: string): Promise<SubtreeAnswerAggregate[]> {
    const version = (await this.cacheManager.get<string>(knowledgeVersionKey(userId))) ?? '0';
    return this.cached(knowledgeAnswersKey(userId, subjectId, version), () =>
      this.repository.aggregateSubtreeAnswers(userId, subjectId),
    );
  }

  private findQuestionCounts(subjectId: string): Promise<SubtreeQuestionCount[]> {
    return this.cached(subjectQuestionCountsKey(subjectId), () => this.repository.countSubtreeQuestions(subjectId));
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = await this.cacheManager.get<T>(key);
    if (hit) {
      return hit;
    }
    const value = await load();
    await this.cacheManager.set(key, value, CACHE_TTL_MS);
    return value;
  }
}
