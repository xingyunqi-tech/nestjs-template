import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateExamCatalog1792265909877 implements MigrationInterface {
  name = 'CreateExamCatalog1792265909877';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "exam" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(50) NOT NULL, "category" character varying(30) NOT NULL, "icon" character varying(255), "description" character varying(500), "sort" integer NOT NULL DEFAULT '0', "status" character varying(20) NOT NULL DEFAULT 'DRAFT', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_56071ab3a94aeac01f1b5ab74aa" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "subject" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "examId" uuid NOT NULL, "name" character varying(50) NOT NULL, "sort" integer NOT NULL DEFAULT '0', "status" character varying(20) NOT NULL DEFAULT 'DRAFT', "hasSubjective" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_12eee115462e38d62e5455fc054" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_subject_examId" ON "subject"  ("examId") `);
    await queryRunner.query(
      `CREATE TABLE "knowledge_point" ("id" uuid NOT NULL, "subjectId" uuid NOT NULL, "parentId" uuid, "name" character varying(50) NOT NULL, "level" smallint NOT NULL, "sort" integer NOT NULL DEFAULT '0', "path" character varying(120) NOT NULL, "isLeaf" boolean NOT NULL DEFAULT true, "questionCount" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_knowledge_point" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_knowledge_point_subjectId" ON "knowledge_point"  ("subjectId") `);
    await queryRunner.query(`CREATE INDEX "IDX_knowledge_point_parentId" ON "knowledge_point"  ("parentId") `);
    await queryRunner.query(
      `CREATE TABLE "user_exam_profile" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "examId" uuid NOT NULL, "isCurrent" boolean NOT NULL DEFAULT false, "examDate" date, "dailyGoal" integer NOT NULL DEFAULT '30', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_92b2416ffc67ad8fe8c1729d8a2" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_user_exam_profile_examId" ON "user_exam_profile"  ("examId") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_exam_profile_userId_current" ON "user_exam_profile"  ("userId") WHERE "isCurrent"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_exam_profile_userId_examId" ON "user_exam_profile"  ("userId", "examId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "subject" ADD CONSTRAINT "FK_subject_exam" FOREIGN KEY ("examId") REFERENCES "exam"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_point" ADD CONSTRAINT "FK_knowledge_point_subject" FOREIGN KEY ("subjectId") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "knowledge_point" ADD CONSTRAINT "FK_knowledge_point_parent" FOREIGN KEY ("parentId") REFERENCES "knowledge_point"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_exam_profile" ADD CONSTRAINT "FK_user_exam_profile_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_exam_profile" ADD CONSTRAINT "FK_user_exam_profile_exam" FOREIGN KEY ("examId") REFERENCES "exam"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_exam_profile" DROP CONSTRAINT "FK_user_exam_profile_exam"`);
    await queryRunner.query(`ALTER TABLE "user_exam_profile" DROP CONSTRAINT "FK_user_exam_profile_user"`);
    await queryRunner.query(`ALTER TABLE "knowledge_point" DROP CONSTRAINT "FK_knowledge_point_parent"`);
    await queryRunner.query(`ALTER TABLE "knowledge_point" DROP CONSTRAINT "FK_knowledge_point_subject"`);
    await queryRunner.query(`ALTER TABLE "subject" DROP CONSTRAINT "FK_subject_exam"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_user_exam_profile_userId_examId"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_user_exam_profile_userId_current"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_user_exam_profile_examId"`);
    await queryRunner.query(`DROP TABLE "user_exam_profile"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_knowledge_point_parentId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_knowledge_point_subjectId"`);
    await queryRunner.query(`DROP TABLE "knowledge_point"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_subject_examId"`);
    await queryRunner.query(`DROP TABLE "subject"`);
    await queryRunner.query(`DROP TABLE "exam"`);
  }
}
