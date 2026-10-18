import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWrongBook1792297556263 implements MigrationInterface {
  name = 'CreateWrongBook1792297556263';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "wrong_question" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "questionId" uuid NOT NULL, "subjectId" uuid NOT NULL, "wrongCount" integer NOT NULL DEFAULT '0', "consecutiveCorrect" integer NOT NULL DEFAULT '0', "lastCorrectDate" date, "lastWrongAnswer" jsonb, "firstWrongAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastWrongAt" TIMESTAMP WITH TIME ZONE NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'ACTIVE', "masteredAt" TIMESTAMP WITH TIME ZONE, "aiAnalysis" text, "aiAnalysisVersion" integer, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_wrong_question" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_wrong_question_questionId" ON "wrong_question"  ("questionId") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_wrong_question_userId_subjectId_status" ON "wrong_question"  ("userId", "subjectId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_wrong_question_userId_status_lastWrongAt" ON "wrong_question"  ("userId", "status", "lastWrongAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_wrong_question_userId_questionId" ON "wrong_question"  ("userId", "questionId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "wrong_question" ADD CONSTRAINT "FK_wrong_question_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wrong_question" ADD CONSTRAINT "FK_wrong_question_question" FOREIGN KEY ("questionId") REFERENCES "question"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "wrong_question" ADD CONSTRAINT "FK_wrong_question_subject" FOREIGN KEY ("subjectId") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wrong_question" DROP CONSTRAINT "FK_wrong_question_subject"`);
    await queryRunner.query(`ALTER TABLE "wrong_question" DROP CONSTRAINT "FK_wrong_question_question"`);
    await queryRunner.query(`ALTER TABLE "wrong_question" DROP CONSTRAINT "FK_wrong_question_user"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_wrong_question_userId_questionId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_wrong_question_userId_status_lastWrongAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_wrong_question_userId_subjectId_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_wrong_question_questionId"`);
    await queryRunner.query(`DROP TABLE "wrong_question"`);
  }
}
