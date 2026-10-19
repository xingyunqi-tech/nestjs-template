import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { StatsEventService } from '../../src/modules/study-stats/stats-event.service';
import { createTransactionHandle } from '../../src/common/database/transaction-handle';

/** 按用户 id 升序持有统计写入锁后删除科目下的会话，与统计事件处理器的事务互斥 */
export async function deletePracticeSessions(app: INestApplication, subjectIds: string[]): Promise<void> {
  const statsEventService = app.get(StatsEventService);
  await app.get(DataSource).transaction(async (manager) => {
    const owners: { userId: number }[] = await manager.query(
      `SELECT DISTINCT "userId" FROM "practice_session" WHERE "subjectId" = ANY($1::uuid[]) ORDER BY "userId"`,
      [subjectIds],
    );
    const handle = createTransactionHandle(manager);
    for (const { userId } of owners) {
      await statsEventService.lockUserStats(handle, userId);
    }
    await manager.query(`DELETE FROM "practice_session" WHERE "subjectId" = ANY($1::uuid[])`, [subjectIds]);
  });
}
