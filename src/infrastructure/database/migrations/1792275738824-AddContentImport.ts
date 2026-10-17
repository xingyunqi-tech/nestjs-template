import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContentImport1792275738824 implements MigrationInterface {
  name = 'AddContentImport1792275738824';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "import_job" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "fileId" uuid NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'PENDING', "publishOnImport" boolean NOT NULL DEFAULT false, "total" integer NOT NULL DEFAULT '0', "succeeded" integer NOT NULL DEFAULT '0', "failed" integer NOT NULL DEFAULT '0', "skipped" integer NOT NULL DEFAULT '0', "errorReportFileId" uuid, "failureReason" character varying(100), "createdBy" integer, "startedAt" TIMESTAMP WITH TIME ZONE, "finishedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_import_job" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_import_job_status" ON "import_job"  ("status") `);
    await queryRunner.query(`CREATE INDEX "IDX_import_job_createdAt" ON "import_job"  ("createdAt") `);
    await queryRunner.query(`ALTER TABLE "file" ADD "sha256" character varying(64)`);
    await queryRunner.query(`CREATE INDEX "IDX_file_sha256" ON "file"  ("sha256") `);
    await queryRunner.query(
      `ALTER TABLE "import_job" ADD CONSTRAINT "FK_import_job_file" FOREIGN KEY ("fileId") REFERENCES "file"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "import_job" ADD CONSTRAINT "FK_import_job_error_report_file" FOREIGN KEY ("errorReportFileId") REFERENCES "file"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "import_job" ADD CONSTRAINT "FK_import_job_user" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "import_job" DROP CONSTRAINT "FK_import_job_user"`);
    await queryRunner.query(`ALTER TABLE "import_job" DROP CONSTRAINT "FK_import_job_error_report_file"`);
    await queryRunner.query(`ALTER TABLE "import_job" DROP CONSTRAINT "FK_import_job_file"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_file_sha256"`);
    await queryRunner.query(`ALTER TABLE "file" DROP COLUMN "sha256"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_import_job_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_import_job_status"`);
    await queryRunner.query(`DROP TABLE "import_job"`);
  }
}
