import { MigrationInterface, QueryRunner } from 'typeorm';

/** 与 RoleEnum 一致 */
const USER_ROLE_ID = 2;
const EDITOR_ROLE_ID = 3;
const REVIEWER_ROLE_ID = 4;

const ROLES: [id: number, name: string][] = [
  [EDITOR_ROLE_ID, 'Editor'],
  [REVIEWER_ROLE_ID, 'Reviewer'],
];

const EDITOR_PERMISSIONS = ['file:upload', 'file:read', 'content:manage', 'ai:generate'];
const REVIEWER_PERMISSIONS = ['file:upload', 'file:read', 'content:manage', 'content:review'];

/** 角色表或角色权限表为空（未执行种子）时不写入，由种子与 PermissionsService 的内置默认映射负责 */
export class AddEditorReviewerRoles1792479465695 implements MigrationInterface {
  name = 'AddEditorReviewerRoles1792479465695';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [id, name] of ROLES) {
      await queryRunner.query(
        `INSERT INTO "role" ("id", "name")
         SELECT $1, $2
         WHERE EXISTS (SELECT 1 FROM "role")
         ON CONFLICT ("id") DO NOTHING`,
        [id, name],
      );
    }
    await this.grant(queryRunner, EDITOR_ROLE_ID, EDITOR_PERMISSIONS);
    await this.grant(queryRunner, REVIEWER_ROLE_ID, REVIEWER_PERMISSIONS);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const ids = ROLES.map(([id]) => id);
    await queryRunner.query(`UPDATE "user" SET "roleId" = $1 WHERE "roleId" = ANY($2)`, [USER_ROLE_ID, ids]);
    await queryRunner.query(`DELETE FROM "role_permission" WHERE "role_id" = ANY($1)`, [ids]);
    await queryRunner.query(`DELETE FROM "role" WHERE "id" = ANY($1)`, [ids]);
  }

  private async grant(queryRunner: QueryRunner, roleId: number, permissionIds: string[]): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "role_permission" ("role_id", "permission_id")
       SELECT $1, "p"."id" FROM "permission" "p"
       WHERE "p"."id" = ANY($2) AND EXISTS (SELECT 1 FROM "role_permission")
         AND EXISTS (SELECT 1 FROM "role" WHERE "id" = $1)
       ON CONFLICT DO NOTHING`,
      [roleId, permissionIds],
    );
  }
}
