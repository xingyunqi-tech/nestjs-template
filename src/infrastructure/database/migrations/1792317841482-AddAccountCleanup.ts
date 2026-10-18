import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAccountCleanup1792317841482 implements MigrationInterface {
  name = 'AddAccountCleanup1792317841482';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "account_cleanup" ("userId" integer NOT NULL, "completedAt" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_account_cleanup" PRIMARY KEY ("userId"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "account_cleanup" ADD CONSTRAINT "FK_account_cleanup_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "account_cleanup" DROP CONSTRAINT "FK_account_cleanup_user"`);
    await queryRunner.query(`DROP TABLE "account_cleanup"`);
  }
}
