import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiContentReportSnapshot1792335900018 implements MigrationInterface {
  name = 'AddAiContentReportSnapshot1792335900018';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "feedback" ADD "messageSnapshot" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "feedback" DROP COLUMN "messageSnapshot"`);
  }
}
