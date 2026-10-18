import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiUsageDailyCachedInputTokens1792338367809 implements MigrationInterface {
  name = 'AddAiUsageDailyCachedInputTokens1792338367809';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ai_usage_daily" ADD "cachedInputTokens" bigint NOT NULL DEFAULT '0'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ai_usage_daily" DROP COLUMN "cachedInputTokens"`);
  }
}
