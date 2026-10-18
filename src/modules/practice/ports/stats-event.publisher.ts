import { Injectable } from '@nestjs/common';

/** 统计事件入队：答完即判与自评按记录，模考交卷按会话 */
export abstract class StatsEventPublisher {
  abstract publishRecord(recordId: string): Promise<void>;

  abstract publishSession(sessionId: string): Promise<void>;
}

@Injectable()
export class NoopStatsEventPublisher implements StatsEventPublisher {
  publishRecord(_recordId: string): Promise<void> {
    return Promise.resolve();
  }

  publishSession(_sessionId: string): Promise<void> {
    return Promise.resolve();
  }
}
