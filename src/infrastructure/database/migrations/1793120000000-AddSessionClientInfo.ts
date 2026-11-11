import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionClientInfo1793120000000 implements MigrationInterface {
  name = 'AddSessionClientInfo1793120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "session" ADD "userAgent" character varying(512)`);
    await queryRunner.query(`ALTER TABLE "session" ADD "ip" character varying(64)`);
    await queryRunner.query(`ALTER TABLE "session" ADD "lastActiveAt" TIMESTAMP`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "session" DROP COLUMN "lastActiveAt"`);
    await queryRunner.query(`ALTER TABLE "session" DROP COLUMN "ip"`);
    await queryRunner.query(`ALTER TABLE "session" DROP COLUMN "userAgent"`);
  }
}
