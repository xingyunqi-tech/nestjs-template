import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePapers1792270132740 implements MigrationInterface {
  name = 'CreatePapers1792270132740';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "daily_question_set" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "subjectId" uuid NOT NULL, "date" date NOT NULL, "questionIds" uuid array NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_daily_question_set" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_daily_question_set_subjectId_date" ON "daily_question_set"  ("subjectId", "date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "paper" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "subjectId" uuid NOT NULL, "title" character varying(100) NOT NULL, "type" character varying(20) NOT NULL, "year" smallint, "ownerUserId" integer, "durationMin" integer NOT NULL, "sections" jsonb NOT NULL DEFAULT '[]', "totalScore" numeric(6,2) NOT NULL DEFAULT '0', "objectiveScore" numeric(6,2) NOT NULL DEFAULT '0', "multiScoringRule" character varying(20) NOT NULL DEFAULT 'ALL_OR_NOTHING', "status" character varying(20) NOT NULL DEFAULT 'DRAFT', "isFree" boolean NOT NULL DEFAULT true, "attemptCount" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_paper" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_paper_ownerUserId" ON "paper"  ("ownerUserId") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_paper_subjectId_status_type" ON "paper"  ("subjectId", "status", "type") `,
    );
    await queryRunner.query(
      `CREATE TABLE "paper_question" ("paperId" uuid NOT NULL, "questionId" uuid NOT NULL, "sectionIndex" smallint NOT NULL, "questionVersion" integer NOT NULL, "sort" integer NOT NULL, "score" numeric(6,2) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_paper_question" PRIMARY KEY ("paperId", "questionId"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_paper_question_questionId" ON "paper_question"  ("questionId") `);
    await queryRunner.query(
      `CREATE TABLE "paper_rule" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "subjectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "durationMin" integer NOT NULL, "multiScoringRule" character varying(20) NOT NULL DEFAULT 'ALL_OR_NOTHING', "items" jsonb NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'DRAFT', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_paper_rule" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_paper_rule_subjectId" ON "paper_rule"  ("subjectId") `);
    await queryRunner.query(
      `ALTER TABLE "daily_question_set" ADD CONSTRAINT "FK_daily_question_set_subject" FOREIGN KEY ("subjectId") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "paper" ADD CONSTRAINT "FK_paper_subject" FOREIGN KEY ("subjectId") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "paper" ADD CONSTRAINT "FK_paper_owner_user" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "paper_question" ADD CONSTRAINT "FK_paper_question_paper" FOREIGN KEY ("paperId") REFERENCES "paper"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "paper_question" ADD CONSTRAINT "FK_paper_question_question" FOREIGN KEY ("questionId") REFERENCES "question"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "paper_rule" ADD CONSTRAINT "FK_paper_rule_subject" FOREIGN KEY ("subjectId") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "paper_rule" DROP CONSTRAINT "FK_paper_rule_subject"`);
    await queryRunner.query(`ALTER TABLE "paper_question" DROP CONSTRAINT "FK_paper_question_question"`);
    await queryRunner.query(`ALTER TABLE "paper_question" DROP CONSTRAINT "FK_paper_question_paper"`);
    await queryRunner.query(`ALTER TABLE "paper" DROP CONSTRAINT "FK_paper_owner_user"`);
    await queryRunner.query(`ALTER TABLE "paper" DROP CONSTRAINT "FK_paper_subject"`);
    await queryRunner.query(`ALTER TABLE "daily_question_set" DROP CONSTRAINT "FK_daily_question_set_subject"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_paper_rule_subjectId"`);
    await queryRunner.query(`DROP TABLE "paper_rule"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_paper_question_questionId"`);
    await queryRunner.query(`DROP TABLE "paper_question"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_paper_subjectId_status_type"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_paper_ownerUserId"`);
    await queryRunner.query(`DROP TABLE "paper"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_daily_question_set_subjectId_date"`);
    await queryRunner.query(`DROP TABLE "daily_question_set"`);
  }
}
