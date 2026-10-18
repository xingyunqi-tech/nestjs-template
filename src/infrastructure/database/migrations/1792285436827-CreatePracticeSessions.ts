import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePracticeSessions1792285436827 implements MigrationInterface {
  name = 'CreatePracticeSessions1792285436827';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "practice_session" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" integer NOT NULL, "subjectId" uuid NOT NULL, "mode" character varying(20) NOT NULL, "paperId" uuid, "dailyDate" date, "scope" jsonb NOT NULL DEFAULT '{}', "questionIds" uuid array NOT NULL, "questionVersions" jsonb NOT NULL, "status" character varying(20) NOT NULL DEFAULT 'IN_PROGRESS', "activeDeviceId" character varying(64), "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deadlineAt" TIMESTAMP WITH TIME ZONE, "autoSubmitAt" TIMESTAMP WITH TIME ZONE, "submittedAt" TIMESTAMP WITH TIME ZONE, "submitType" character varying(20), "lastActiveAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "isFirstAttempt" boolean NOT NULL DEFAULT false, "scoringScheme" character varying(20), "score" numeric(6,2), "totalScore" numeric(6,2), "correctCount" integer NOT NULL DEFAULT '0', "answeredCount" integer NOT NULL DEFAULT '0', "durationSec" integer NOT NULL DEFAULT '0', "lastIndex" integer NOT NULL DEFAULT '0', "pendingGrading" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_practice_session" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_practice_session_subjectId" ON "practice_session"  ("subjectId") `);
    await queryRunner.query(
      `CREATE INDEX "IDX_practice_session_userId_startedAt" ON "practice_session"  ("userId", "startedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_practice_session_userId_status_lastActiveAt" ON "practice_session"  ("userId", "status", "lastActiveAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_practice_session_percentile" ON "practice_session"  ("paperId", "scoringScheme", "isFirstAttempt", "status", "score") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_practice_session_status_lastActiveAt" ON "practice_session"  ("status", "lastActiveAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_practice_session_status_autoSubmitAt" ON "practice_session"  ("status", "autoSubmitAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_practice_session_questionIds" ON "practice_session" USING gin ("questionIds") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_practice_session_userId_subjectId_dailyDate" ON "practice_session"  ("userId", "subjectId", "dailyDate") WHERE "mode" = 'DAILY'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_practice_session_userId_paperId_first_attempt" ON "practice_session"  ("userId", "paperId") WHERE "isFirstAttempt"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_practice_session_userId_paperId_in_progress_mock" ON "practice_session"  ("userId", "paperId") WHERE "status" = 'IN_PROGRESS' AND "mode" = 'MOCK'`,
    );
    await queryRunner.query(
      `CREATE TABLE "answer_record" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "sessionId" uuid NOT NULL, "userId" integer NOT NULL, "questionId" uuid NOT NULL, "questionVersion" integer NOT NULL, "answer" jsonb, "isCorrect" boolean, "isPartial" boolean NOT NULL DEFAULT false, "score" numeric(6,2), "selfAssessment" character varying(20), "gradingStatus" character varying(20), "gradingTaskId" uuid, "durationSec" integer NOT NULL DEFAULT '0', "markedForReview" boolean NOT NULL DEFAULT false, "deviceId" character varying(64) NOT NULL, "clientSeq" integer NOT NULL DEFAULT '0', "clientAnsweredAt" TIMESTAMP WITH TIME ZONE NOT NULL, "answeredAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "gradedAt" TIMESTAMP WITH TIME ZONE, "statDate" date, "statsAppliedAt" TIMESTAMP WITH TIME ZONE, "firstForQuestion" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_answer_record" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_answer_record_gradedAt_stats_pending" ON "answer_record"  ("gradedAt") WHERE "statsAppliedAt" IS NULL AND "isCorrect" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_answer_record_questionId_gradedAt" ON "answer_record"  ("questionId", "gradedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_answer_record_userId_questionId" ON "answer_record"  ("userId", "questionId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_answer_record_userId_questionId_first" ON "answer_record"  ("userId", "questionId") WHERE "firstForQuestion"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_answer_record_sessionId_questionId" ON "answer_record"  ("sessionId", "questionId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "practice_session" ADD CONSTRAINT "FK_practice_session_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "practice_session" ADD CONSTRAINT "FK_practice_session_subject" FOREIGN KEY ("subjectId") REFERENCES "subject"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "practice_session" ADD CONSTRAINT "FK_practice_session_paper" FOREIGN KEY ("paperId") REFERENCES "paper"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "answer_record" ADD CONSTRAINT "FK_answer_record_session" FOREIGN KEY ("sessionId") REFERENCES "practice_session"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "answer_record" ADD CONSTRAINT "FK_answer_record_user" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "answer_record" ADD CONSTRAINT "FK_answer_record_question" FOREIGN KEY ("questionId") REFERENCES "question"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "answer_record" DROP CONSTRAINT "FK_answer_record_question"`);
    await queryRunner.query(`ALTER TABLE "answer_record" DROP CONSTRAINT "FK_answer_record_user"`);
    await queryRunner.query(`ALTER TABLE "answer_record" DROP CONSTRAINT "FK_answer_record_session"`);
    await queryRunner.query(`ALTER TABLE "practice_session" DROP CONSTRAINT "FK_practice_session_paper"`);
    await queryRunner.query(`ALTER TABLE "practice_session" DROP CONSTRAINT "FK_practice_session_subject"`);
    await queryRunner.query(`ALTER TABLE "practice_session" DROP CONSTRAINT "FK_practice_session_user"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_answer_record_sessionId_questionId"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_answer_record_userId_questionId_first"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_answer_record_userId_questionId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_answer_record_questionId_gradedAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_answer_record_gradedAt_stats_pending"`);
    await queryRunner.query(`DROP TABLE "answer_record"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_practice_session_userId_paperId_in_progress_mock"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_practice_session_userId_paperId_first_attempt"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_practice_session_userId_subjectId_dailyDate"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_practice_session_questionIds"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_practice_session_status_autoSubmitAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_practice_session_status_lastActiveAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_practice_session_percentile"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_practice_session_userId_status_lastActiveAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_practice_session_userId_startedAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_practice_session_subjectId"`);
    await queryRunner.query(`DROP TABLE "practice_session"`);
  }
}
