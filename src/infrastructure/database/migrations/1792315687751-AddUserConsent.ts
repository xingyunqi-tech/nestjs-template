import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserConsent1792315687751 implements MigrationInterface {
  name = 'AddUserConsent1792315687751';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_consent" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "type" character varying(20) NOT NULL, "version" character varying(50) NOT NULL, "agreedAt" TIMESTAMP NOT NULL DEFAULT now(), "ip" character varying(45), CONSTRAINT "PK_user_consent" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_consent_userId_type_version" ON "user_consent"  ("userId", "type", "version") `,
    );
    await queryRunner.query(
      `ALTER TABLE "user_consent" ADD CONSTRAINT "FK_user_consent_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "user_consent" DROP CONSTRAINT "FK_user_consent_user"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_user_consent_userId_type_version"`);
    await queryRunner.query(`DROP TABLE "user_consent"`);
  }
}
