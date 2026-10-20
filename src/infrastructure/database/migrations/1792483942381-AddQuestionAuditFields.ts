import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuestionAuditFields1792483942381 implements MigrationInterface {
  name = 'AddQuestionAuditFields1792483942381';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "question" ADD "createdBy" integer`);
    await queryRunner.query(`ALTER TABLE "question" ADD "submittedBy" integer`);
    await queryRunner.query(`ALTER TABLE "question" ADD "submittedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "question" ADD "reviewedBy" integer`);
    await queryRunner.query(`ALTER TABLE "question" ADD "reviewedAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(`ALTER TABLE "question" ADD "rejectReason" character varying(500)`);
    await queryRunner.query(
      `ALTER TABLE "question" ADD CONSTRAINT "FK_question_creator" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "question" ADD CONSTRAINT "FK_question_submitter" FOREIGN KEY ("submittedBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "question" ADD CONSTRAINT "FK_question_reviewer" FOREIGN KEY ("reviewedBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "question" DROP CONSTRAINT "FK_question_reviewer"`);
    await queryRunner.query(`ALTER TABLE "question" DROP CONSTRAINT "FK_question_submitter"`);
    await queryRunner.query(`ALTER TABLE "question" DROP CONSTRAINT "FK_question_creator"`);
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "rejectReason"`);
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "reviewedAt"`);
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "reviewedBy"`);
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "submittedAt"`);
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "submittedBy"`);
    await queryRunner.query(`ALTER TABLE "question" DROP COLUMN "createdBy"`);
  }
}
