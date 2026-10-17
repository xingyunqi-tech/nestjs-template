import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateQuestionBank1792268501775 implements MigrationInterface {
  name = 'CreateQuestionBank1792268501775';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "question" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "subjectId" uuid NOT NULL, "parentId" uuid, "type" character varying(20) NOT NULL, "currentVersion" integer NOT NULL DEFAULT '0', "stem" text NOT NULL, "options" jsonb, "answer" jsonb, "analysis" text, "difficulty" smallint NOT NULL DEFAULT '3', "material" text, "audioFileId" uuid, "source" character varying(20) NOT NULL DEFAULT 'ORIGINAL', "sourceNote" character varying(100), "status" character varying(20) NOT NULL DEFAULT 'DRAFT', "isFree" boolean NOT NULL DEFAULT true, "sort" integer NOT NULL DEFAULT '0', "contentHash" character(64) NOT NULL, "statAnswered" integer NOT NULL DEFAULT '0', "statCorrect" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_question" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_question_parentId" ON "question"  ("parentId") `);
    await queryRunner.query(`CREATE INDEX "IDX_question_status" ON "question"  ("status") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_question_subjectId_contentHash" ON "question"  ("subjectId", "contentHash") `,
    );
    await queryRunner.query(
      `CREATE TABLE "question_version" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "questionId" uuid NOT NULL, "version" integer NOT NULL, "type" character varying(20) NOT NULL, "stem" text NOT NULL, "options" jsonb, "answer" jsonb, "analysis" text, "material" text, "audioFileId" uuid, "knowledgePointIds" uuid array NOT NULL DEFAULT '{}', "materialVersion" integer, "changeType" character varying(10) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_question_version" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_question_version_questionId_version" ON "question_version"  ("questionId", "version") `,
    );
    await queryRunner.query(
      `CREATE TABLE "question_knowledge_point" ("questionId" uuid NOT NULL, "knowledgePointId" uuid NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_question_knowledge_point" PRIMARY KEY ("questionId", "knowledgePointId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_question_knowledge_point_knowledgePointId" ON "question_knowledge_point"  ("knowledgePointId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "question" ADD CONSTRAINT "FK_question_subject" FOREIGN KEY ("subjectId") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "question" ADD CONSTRAINT "FK_question_parent" FOREIGN KEY ("parentId") REFERENCES "question"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "question_version" ADD CONSTRAINT "FK_question_version_question" FOREIGN KEY ("questionId") REFERENCES "question"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "question_knowledge_point" ADD CONSTRAINT "FK_question_knowledge_point_question" FOREIGN KEY ("questionId") REFERENCES "question"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "question_knowledge_point" ADD CONSTRAINT "FK_question_knowledge_point_knowledge_point" FOREIGN KEY ("knowledgePointId") REFERENCES "knowledge_point"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "question_knowledge_point" DROP CONSTRAINT "FK_question_knowledge_point_knowledge_point"`,
    );
    await queryRunner.query(
      `ALTER TABLE "question_knowledge_point" DROP CONSTRAINT "FK_question_knowledge_point_question"`,
    );
    await queryRunner.query(`ALTER TABLE "question_version" DROP CONSTRAINT "FK_question_version_question"`);
    await queryRunner.query(`ALTER TABLE "question" DROP CONSTRAINT "FK_question_parent"`);
    await queryRunner.query(`ALTER TABLE "question" DROP CONSTRAINT "FK_question_subject"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_question_knowledge_point_knowledgePointId"`);
    await queryRunner.query(`DROP TABLE "question_knowledge_point"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_question_version_questionId_version"`);
    await queryRunner.query(`DROP TABLE "question_version"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_question_subjectId_contentHash"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_question_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_question_parentId"`);
    await queryRunner.query(`DROP TABLE "question"`);
  }
}
