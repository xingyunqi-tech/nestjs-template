import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { AllConfigType } from '../../config/config.type';
import { MONITORED_QUEUES } from './monitor.constants';
import { QueuesOverviewDto, QueueStatsDto } from './dto/queue-stats.dto';

export const QUEUE_STATS_TIMEOUT_MS = 3000;

@Injectable()
export class QueueMonitorService {
  private readonly logger = new Logger(QueueMonitorService.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly configService: ConfigService<AllConfigType>,
  ) {}

  async getOverview(): Promise<QueuesOverviewDto> {
    if (!this.configService.get('redis.enabled', { infer: true })) {
      return { enabled: false, queues: [] };
    }

    const queues: QueueStatsDto[] = [];
    for (const name of MONITORED_QUEUES) {
      const queue = this.findQueue(name);
      if (queue) {
        queues.push(await this.getStats(name, queue));
      }
    }
    return { enabled: true, queues };
  }

  private findQueue(name: string): Queue | null {
    try {
      return this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
    } catch {
      this.logger.warn(`Queue ${name} is not registered`);
      return null;
    }
  }

  private async getStats(name: string, queue: Queue): Promise<QueueStatsDto> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${QUEUE_STATS_TIMEOUT_MS}ms`)),
        QUEUE_STATS_TIMEOUT_MS,
      );
    });
    try {
      const counts = await Promise.race([
        queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'prioritized'),
        timeout,
      ]);
      return {
        name,
        available: true,
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
        completed: counts.completed ?? 0,
        prioritized: counts.prioritized ?? 0,
      };
    } catch (error) {
      this.logger.warn(`Queue ${name} stats unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return { name, available: false, waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, prioritized: 0 };
    } finally {
      clearTimeout(timer);
    }
  }
}
