import { MigrationInterface, QueryRunner } from 'typeorm';

/** 与 RoleEnum 一致 */
const ADMIN_ROLE_ID = 1;
const USER_ROLE_ID = 2;

const PERMISSIONS: [id: string, name: string, description: string, resource: string, action: string][] = [
  ['practice:write', 'Write Practice', 'Create practice sessions and submit answers', 'practice', 'write'],
  ['ai:chat', 'AI Chat', 'Chat with the AI tutor', 'ai', 'chat'],
  ['ai:grading', 'AI Grading', 'Submit answers for AI grading', 'ai', 'grading'],
  [
    'content:manage',
    'Manage Content',
    'Manage exams, subjects, knowledge points, questions, papers and imports',
    'content',
    'manage',
  ],
  [
    'content:review',
    'Review Content',
    'Review, publish and take down questions; handle errata and reports',
    'content',
    'review',
  ],
  ['ai:generate', 'AI Generate', 'Generate questions with AI', 'ai', 'generate'],
  ['ai:admin', 'AI Admin', 'View AI usage and cost', 'ai', 'admin'],
];

const USER_PERMISSIONS = ['practice:write', 'ai:chat', 'ai:grading'];

/** 权限表为空（未执行种子）时不写入，由 PermissionsService 使用内置默认映射 */
export class AddExamPrepPermissions1792257059541 implements MigrationInterface {
  name = 'AddExamPrepPermissions1792257059541';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [id, name, description, resource, action] of PERMISSIONS) {
      await queryRunner.query(
        `INSERT INTO "permission" ("id", "name", "description", "resource", "action")
         SELECT $1, $2, $3, $4, $5
         WHERE EXISTS (SELECT 1 FROM "permission")
         ON CONFLICT ("id") DO NOTHING`,
        [id, name, description, resource, action],
      );
    }
    await this.grant(
      queryRunner,
      ADMIN_ROLE_ID,
      PERMISSIONS.map(([id]) => id),
    );
    await this.grant(queryRunner, USER_ROLE_ID, USER_PERMISSIONS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const ids = PERMISSIONS.map(([id]) => id);
    await queryRunner.query(`DELETE FROM "role_permission" WHERE "permission_id" = ANY($1)`, [ids]);
    await queryRunner.query(`DELETE FROM "permission" WHERE "id" = ANY($1)`, [ids]);
  }

  private async grant(queryRunner: QueryRunner, roleId: number, permissionIds: string[]): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "role_permission" ("role_id", "permission_id")
       SELECT $1, "p"."id" FROM "permission" "p"
       WHERE "p"."id" = ANY($2) AND EXISTS (SELECT 1 FROM "role_permission")
       ON CONFLICT DO NOTHING`,
      [roleId, permissionIds],
    );
  }
}
