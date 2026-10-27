import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGamePlayer1793077408938 implements MigrationInterface {
  name = 'AddGamePlayer1793077408938';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "game_player" ("id" SERIAL NOT NULL, "platform" character varying(20) NOT NULL, "openId" character varying(64) NOT NULL, "unionId" character varying(64), "refreshHash" character varying(64) NOT NULL, "lastLoginAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_game_player" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_game_player_platform_openId" ON "game_player"  ("platform", "openId") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."UQ_game_player_platform_openId"`);
    await queryRunner.query(`DROP TABLE "game_player"`);
  }
}
