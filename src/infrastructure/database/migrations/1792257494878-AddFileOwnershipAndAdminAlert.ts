import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFileOwnershipAndAdminAlert1792257494878 implements MigrationInterface {
  name = 'AddFileOwnershipAndAdminAlert1792257494878';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "admin_alert" ("id" SERIAL NOT NULL, "type" character varying(50) NOT NULL, "level" character varying(20) NOT NULL, "message" text NOT NULL, "payload" jsonb, "dedupKey" character varying(200) NOT NULL, "acknowledgedAt" TIMESTAMP, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_44cf0b17edf69fb3f9b62c1ee7b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_admin_alert_type" ON "admin_alert"  ("type") `);
    await queryRunner.query(`CREATE INDEX "IDX_admin_alert_createdAt" ON "admin_alert"  ("createdAt") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_admin_alert_dedupKey_open" ON "admin_alert"  ("dedupKey") WHERE "acknowledgedAt" IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "file" ADD "ownerUserId" integer`);
    await queryRunner.query(`ALTER TABLE "file" ADD "visibility" character varying(10) NOT NULL DEFAULT 'PUBLIC'`);
    await queryRunner.query(`ALTER TABLE "file" ADD "mimeType" character varying(100)`);
    await queryRunner.query(`ALTER TABLE "file" ADD "size" integer`);
    await queryRunner.query(`CREATE INDEX "IDX_file_path" ON "file"  ("path") `);
    await queryRunner.query(`CREATE INDEX "IDX_file_ownerUserId" ON "file"  ("ownerUserId") `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_file_ownerUserId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_file_path"`);
    await queryRunner.query(`ALTER TABLE "file" DROP COLUMN "size"`);
    await queryRunner.query(`ALTER TABLE "file" DROP COLUMN "mimeType"`);
    await queryRunner.query(`ALTER TABLE "file" DROP COLUMN "visibility"`);
    await queryRunner.query(`ALTER TABLE "file" DROP COLUMN "ownerUserId"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_admin_alert_dedupKey_open"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_admin_alert_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_admin_alert_type"`);
    await queryRunner.query(`DROP TABLE "admin_alert"`);
  }
}
