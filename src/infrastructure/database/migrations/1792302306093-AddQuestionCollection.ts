import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuestionCollection1792302306093 implements MigrationInterface {
  name = 'AddQuestionCollection1792302306093';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "question_note" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "questionId" uuid NOT NULL, "subjectId" uuid NOT NULL, "content" text NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_question_note" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_question_note_questionId" ON "question_note"  ("questionId") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_question_note_userId_updatedAt" ON "question_note"  ("userId", "updatedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_question_note_userId_subjectId_updatedAt" ON "question_note"  ("userId", "subjectId", "updatedAt") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_question_note_userId_questionId" ON "question_note"  ("userId", "questionId") `,
    );
    await queryRunner.query(`ALTER TABLE "favorite" ADD "subjectId" uuid`);
    await queryRunner.query(`CREATE INDEX "IDX_favorite_userId_subjectId" ON "favorite"  ("userId", "subjectId") `);
    await queryRunner.query(
      `ALTER TABLE "question_note" ADD CONSTRAINT "FK_question_note_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "question_note" ADD CONSTRAINT "FK_question_note_question" FOREIGN KEY ("questionId") REFERENCES "question"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "question_note" ADD CONSTRAINT "FK_question_note_subject" FOREIGN KEY ("subjectId") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "question_note" DROP CONSTRAINT "FK_question_note_subject"`);
    await queryRunner.query(`ALTER TABLE "question_note" DROP CONSTRAINT "FK_question_note_question"`);
    await queryRunner.query(`ALTER TABLE "question_note" DROP CONSTRAINT "FK_question_note_user"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_favorite_userId_subjectId"`);
    await queryRunner.query(`ALTER TABLE "favorite" DROP COLUMN "subjectId"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_question_note_userId_questionId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_question_note_userId_subjectId_updatedAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_question_note_userId_updatedAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_question_note_questionId"`);
    await queryRunner.query(`DROP TABLE "question_note"`);
  }
}
