import { ConfigService } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE_STATS_TIMEOUT_MS, QueueMonitorService } from './queue-monitor.service';
import { MAIL_QUEUE } from '../../infrastructure/queue/mail-queue/mail-queue.constants';

function config(enabled: boolean): ConfigService {
  return { get: () => enabled } as unknown as ConfigService;
}

describe('QueueMonitorService', () => {
  const mailQueue = {
    getJobCounts: vi.fn().mockResolvedValue({ waiting: 3, active: 1, delayed: 0, failed: 2, completed: 10 }),
  };
  const moduleRef = {
    get: vi.fn((token: string) => {
      if (token === getQueueToken(MAIL_QUEUE)) {
        return mailQueue;
      }
      throw new Error('not found');
    }),
  } as unknown as ModuleRef;

  it('should report queues as disabled without Redis', async () => {
    await expect(new QueueMonitorService(moduleRef, config(false)).getOverview()).resolves.toEqual({
      enabled: false,
      queues: [],
    });
  });

  it('should report job counts of registered queues and skip missing ones', async () => {
    await expect(new QueueMonitorService(moduleRef, config(true)).getOverview()).resolves.toEqual({
      enabled: true,
      queues: [
        {
          name: MAIL_QUEUE,
          available: true,
          waiting: 3,
          active: 1,
          delayed: 0,
          failed: 2,
          completed: 10,
          prioritized: 0,
        },
      ],
    });
  });

  it('should report a queue as unavailable when counting times out', async () => {
    vi.useFakeTimers();
    try {
      mailQueue.getJobCounts.mockReturnValueOnce(new Promise(() => undefined));
      const overview = new QueueMonitorService(moduleRef, config(true)).getOverview();
      await vi.advanceTimersByTimeAsync(QUEUE_STATS_TIMEOUT_MS);

      await expect(overview).resolves.toEqual({
        enabled: true,
        queues: [
          {
            name: MAIL_QUEUE,
            available: false,
            waiting: 0,
            active: 0,
            delayed: 0,
            failed: 0,
            completed: 0,
            prioritized: 0,
          },
        ],
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
