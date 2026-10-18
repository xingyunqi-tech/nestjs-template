import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuestionFeedbackErrata1792310375601 implements MigrationInterface {
  name = 'AddQuestionFeedbackErrata1792310375601';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "feedback" DROP CONSTRAINT "FK_feedback_user"`);
    await queryRunner.query(
      `CREATE TABLE "errata" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "questionId" uuid NOT NULL, "fromVersion" integer NOT NULL, "toVersion" integer NOT NULL, "answerChanged" boolean NOT NULL, "status" character varying(10) NOT NULL DEFAULT 'PENDING', "affectedUsers" integer NOT NULL DEFAULT '0', "processedUsers" integer NOT NULL DEFAULT '0', "reply" text NOT NULL, "failureReason" character varying(500), "createdBy" integer, "startedAt" TIMESTAMP WITH TIME ZONE, "finishedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_errata" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_errata_questionId" ON "errata"  ("questionId") `);
    await queryRunner.query(`CREATE INDEX "IDX_errata_status" ON "errata"  ("status") `);
    await queryRunner.query(`CREATE INDEX "IDX_errata_createdAt" ON "errata"  ("createdAt") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_errata_questionId_active" ON "errata"  ("questionId") WHERE "status" IN ('PENDING', 'RUNNING')`,
    );
    await queryRunner.query(
      `CREATE TABLE "errata_user" ("errataId" uuid NOT NULL, "userId" integer NOT NULL, "notified" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_errata_user" PRIMARY KEY ("errataId", "userId"))`,
    );
    await queryRunner.query(`ALTER TABLE "feedback" ADD "questionId" uuid`);
    await queryRunner.query(`ALTER TABLE "feedback" ADD "questionVersion" integer`);
    await queryRunner.query(`ALTER TABLE "feedback" ADD "reason" character varying(20)`);
    await queryRunner.query(`ALTER TABLE "feedback" ADD "errataId" uuid`);
    await queryRunner.query(`ALTER TABLE "feedback" ADD "messageId" uuid`);
    await queryRunner.query(`ALTER TABLE "feedback" ALTER COLUMN "userId" DROP NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_feedback_questionId" ON "feedback"  ("questionId") `);
    await queryRunner.query(`CREATE INDEX "IDX_feedback_errataId" ON "feedback"  ("errataId") `);
    await queryRunner.query(
      `ALTER TABLE "errata" ADD CONSTRAINT "FK_errata_question" FOREIGN KEY ("questionId") REFERENCES "question"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "errata" ADD CONSTRAINT "FK_errata_user" FOREIGN KEY ("createdBy") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "errata_user" ADD CONSTRAINT "FK_errata_user_errata" FOREIGN KEY ("errataId") REFERENCES "errata"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "errata_user" ADD CONSTRAINT "FK_errata_user_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "feedback" ADD CONSTRAINT "FK_feedback_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "feedback" ADD CONSTRAINT "FK_feedback_question" FOREIGN KEY ("questionId") REFERENCES "question"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "feedback" ADD CONSTRAINT "FK_feedback_errata" FOREIGN KEY ("errataId") REFERENCES "errata"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "feedback" DROP CONSTRAINT "FK_feedback_errata"`);
    await queryRunner.query(`ALTER TABLE "feedback" DROP CONSTRAINT "FK_feedback_question"`);
    await queryRunner.query(`ALTER TABLE "feedback" DROP CONSTRAINT "FK_feedback_user"`);
    await queryRunner.query(`ALTER TABLE "errata_user" DROP CONSTRAINT "FK_errata_user_user"`);
    await queryRunner.query(`ALTER TABLE "errata_user" DROP CONSTRAINT "FK_errata_user_errata"`);
    await queryRunner.query(`ALTER TABLE "errata" DROP CONSTRAINT "FK_errata_user"`);
    await queryRunner.query(`ALTER TABLE "errata" DROP CONSTRAINT "FK_errata_question"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_feedback_errataId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_feedback_questionId"`);
    await queryRunner.query(
      `DELETE FROM "feedback" WHERE "userId" IS NULL OR "type" IN ('question_error', 'ai_content')`,
    );
    await queryRunner.query(`ALTER TABLE "feedback" ALTER COLUMN "userId" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "feedback" DROP COLUMN "messageId"`);
    await queryRunner.query(`ALTER TABLE "feedback" DROP COLUMN "errataId"`);
    await queryRunner.query(`ALTER TABLE "feedback" DROP COLUMN "reason"`);
    await queryRunner.query(`ALTER TABLE "feedback" DROP COLUMN "questionVersion"`);
    await queryRunner.query(`ALTER TABLE "feedback" DROP COLUMN "questionId"`);
    await queryRunner.query(`DROP TABLE "errata_user"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_errata_questionId_active"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_errata_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_errata_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_errata_questionId"`);
    await queryRunner.query(`DROP TABLE "errata"`);
    await queryRunner.query(
      `ALTER TABLE "feedback" ADD CONSTRAINT "FK_feedback_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }
}
