import { MigrationInterface, QueryRunner } from 'typeorm';

/** 题目、题目版本与考试图标引用的文件及音频文件改为无主文件；down 不还原归属 */
export class DetachContentAssetOwners1792317886517 implements MigrationInterface {
  name = 'DetachContentAssetOwners1792317886517';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `WITH content AS (
         SELECT concat_ws(' ', "stem", "options"::text, "analysis", "material") AS "text", "audioFileId" FROM "question"
         UNION ALL
         SELECT concat_ws(' ', "stem", "options"::text, "analysis", "material"), "audioFileId" FROM "question_version"
         UNION ALL
         SELECT "icon", NULL FROM "exam"
       ),
       referenced AS (
         SELECT lower((regexp_matches(c."text", 'file:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})', 'g'))[1])::uuid AS "id"
         FROM content AS c
         UNION
         SELECT "audioFileId" FROM content WHERE "audioFileId" IS NOT NULL
       )
       UPDATE "file" SET "ownerUserId" = NULL
       WHERE "ownerUserId" IS NOT NULL
         AND ("mimeType" LIKE 'audio/%' OR "id" IN (SELECT "id" FROM referenced))`,
    );
  }

  public async down(): Promise<void> {}
}
