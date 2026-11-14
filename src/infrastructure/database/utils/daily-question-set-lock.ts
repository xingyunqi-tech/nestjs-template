import { EntityManager } from 'typeorm';

/** 按科目与日期互斥：用户创建每日一练会话与管理端重新生成题组 */
export async function lockDailyQuestionSet(manager: EntityManager, subjectId: string, date: string): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext('daily_question_set'), hashtext($1))`, [
    `${subjectId}:${date}`,
  ]);
}

/** 题组不存在时返回 null */
export async function findDailyQuestionSetIds(
  manager: EntityManager,
  subjectId: string,
  date: string,
): Promise<string[] | null> {
  const [row]: { questionIds: string[] }[] = await manager.query(
    `SELECT "questionIds"::text[] AS "questionIds" FROM "daily_question_set" WHERE "subjectId" = $1 AND "date" = $2`,
    [subjectId, date],
  );
  return row ? row.questionIds : null;
}
