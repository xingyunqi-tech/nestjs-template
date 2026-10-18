import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiTutor1792332755127 implements MigrationInterface {
  name = 'AddAiTutor1792332755127';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ai_conversation" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "title" character varying(100) NOT NULL, "contextType" character varying(20) NOT NULL, "contextId" character varying(64), "contextVersion" integer, "summary" text, "summaryUpToMessageId" uuid, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ai_conversation" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ai_conversation_user_context" ON "ai_conversation"  ("userId", "contextType", "contextId", "contextVersion") WHERE "contextId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_conversation_userId_updatedAt" ON "ai_conversation"  ("userId", "updatedAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ai_usage_daily" ("id" SERIAL NOT NULL, "date" date NOT NULL, "model" character varying(100) NOT NULL, "kind" character varying(20) NOT NULL, "requests" integer NOT NULL DEFAULT '0', "failures" integer NOT NULL DEFAULT '0', "inputTokens" bigint NOT NULL DEFAULT '0', "outputTokens" bigint NOT NULL DEFAULT '0', "cost" numeric(14,6) NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ai_usage_daily" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_ai_usage_daily_date_model_kind" ON "ai_usage_daily"  ("date", "model", "kind") `,
    );
    await queryRunner.query(
      `CREATE TABLE "ai_message" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "conversationId" uuid NOT NULL, "role" character varying(20) NOT NULL, "content" text NOT NULL DEFAULT '', "reasoning" text, "suggestions" jsonb, "status" character varying(20) NOT NULL, "feedback" character varying(20), "usage" jsonb, "quotaDate" date, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_ai_message" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_message_streaming_createdAt" ON "ai_message"  ("createdAt") WHERE "status" = 'STREAMING'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ai_message_conversationId_createdAt" ON "ai_message"  ("conversationId", "createdAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_conversation" ADD CONSTRAINT "FK_ai_conversation_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ai_message" ADD CONSTRAINT "FK_ai_message_conversation" FOREIGN KEY ("conversationId") REFERENCES "ai_conversation"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "ai_message" DROP CONSTRAINT "FK_ai_message_conversation"`);
    await queryRunner.query(`ALTER TABLE "ai_conversation" DROP CONSTRAINT "FK_ai_conversation_user"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ai_message_conversationId_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ai_message_streaming_createdAt"`);
    await queryRunner.query(`DROP TABLE "ai_message"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_ai_usage_daily_date_model_kind"`);
    await queryRunner.query(`DROP TABLE "ai_usage_daily"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_ai_conversation_userId_updatedAt"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_ai_conversation_user_context"`);
    await queryRunner.query(`DROP TABLE "ai_conversation"`);
  }
}
