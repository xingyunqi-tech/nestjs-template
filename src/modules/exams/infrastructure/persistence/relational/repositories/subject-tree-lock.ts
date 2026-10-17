import { EntityManager } from 'typeorm';

export async function lockSubjectTree(manager: EntityManager, subjectId: string): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext('knowledge_point'), hashtext($1))`, [subjectId]);
}
