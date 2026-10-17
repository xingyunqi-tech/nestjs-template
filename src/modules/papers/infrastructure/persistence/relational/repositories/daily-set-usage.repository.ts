import { Injectable } from '@nestjs/common';
import { DailySetUsageRepository } from '../../daily-set-usage.repository';

@Injectable()
export class NoSessionDailySetUsageRepository implements DailySetUsageRepository {
  hasSessions(_subjectId: string, _date: string): Promise<boolean> {
    return Promise.resolve(false);
  }
}
