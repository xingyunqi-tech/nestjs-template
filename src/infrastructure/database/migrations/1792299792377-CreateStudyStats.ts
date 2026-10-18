import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStudyStats1792299792377 implements MigrationInterface {
  name = 'CreateStudyStats1792299792377';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "study_checkin" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "date" date NOT NULL, "reason" character varying(20) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_study_checkin" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_study_checkin_userId_date" ON "study_checkin"  ("userId", "date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user_knowledge_stat" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "knowledgePointId" uuid NOT NULL, "answered" integer NOT NULL DEFAULT '0', "correct" integer NOT NULL DEFAULT '0', "recentResults" smallint array NOT NULL DEFAULT '{}', "lastAnsweredAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_user_knowledge_stat" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_knowledge_stat_knowledgePointId" ON "user_knowledge_stat"  ("knowledgePointId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_knowledge_stat_userId_knowledgePointId" ON "user_knowledge_stat"  ("userId", "knowledgePointId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "user_daily_stat" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "date" date NOT NULL, "subjectId" uuid NOT NULL, "answered" integer NOT NULL DEFAULT '0', "correct" integer NOT NULL DEFAULT '0', "durationSec" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_user_daily_stat" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_user_daily_stat_subjectId" ON "user_daily_stat"  ("subjectId") `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_daily_stat_userId_date_subjectId" ON "user_daily_stat"  ("userId", "date", "subjectId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "study_checkin" ADD CONSTRAINT "FK_study_checkin_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_knowledge_stat" ADD CONSTRAINT "FK_user_knowledge_stat_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_knowledge_stat" ADD CONSTRAINT "FK_user_knowledge_stat_knowledge_point" FOREIGN KEY ("knowledgePointId") REFERENCES "knowledge_point"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_daily_stat" ADD CONSTRAINT "FK_user_daily_stat_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_daily_stat" ADD CONSTRAINT "FK_user_daily_stat_subject" FOREIGN KEY ("subjectId") REFERENCES "subject"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_daily_stat" DROP CONSTRAINT "FK_user_daily_stat_subject"`);
    await queryRunner.query(`ALTER TABLE "user_daily_stat" DROP CONSTRAINT "FK_user_daily_stat_user"`);
    await queryRunner.query(
      `ALTER TABLE "user_knowledge_stat" DROP CONSTRAINT "FK_user_knowledge_stat_knowledge_point"`,
    );
    await queryRunner.query(`ALTER TABLE "user_knowledge_stat" DROP CONSTRAINT "FK_user_knowledge_stat_user"`);
    await queryRunner.query(`ALTER TABLE "study_checkin" DROP CONSTRAINT "FK_study_checkin_user"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_user_daily_stat_userId_date_subjectId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_user_daily_stat_subjectId"`);
    await queryRunner.query(`DROP TABLE "user_daily_stat"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_user_knowledge_stat_userId_knowledgePointId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_user_knowledge_stat_knowledgePointId"`);
    await queryRunner.query(`DROP TABLE "user_knowledge_stat"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_study_checkin_userId_date"`);
    await queryRunner.query(`DROP TABLE "study_checkin"`);
  }
}
