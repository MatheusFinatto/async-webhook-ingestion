import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitSchema1783547200000 implements MigrationInterface {
  name = 'InitSchema1783547200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "events_status_enum" AS ENUM ('received', 'processing', 'processed', 'failed', 'dead')`,
    );

    await queryRunner.query(`
      CREATE TABLE "events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "event_id" varchar(255) NOT NULL,
        "event_type" varchar(255) NOT NULL,
        "status" "events_status_enum" NOT NULL DEFAULT 'received',
        "attempts" integer NOT NULL DEFAULT 0,
        "correlation_id" varchar(255) NOT NULL,
        "payload" jsonb NOT NULL,
        "failure_reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_events_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_events_event_id" ON "events" ("event_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_events_correlation_id" ON "events" ("correlation_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "dlq_messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "message_id" varchar(255),
        "correlation_id" varchar(255) NOT NULL,
        "event_id" varchar(255),
        "reason" text NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "payload" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dlq_messages_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_dlq_messages_message_id" ON "dlq_messages" ("message_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dlq_messages_correlation_id" ON "dlq_messages" ("correlation_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_dlq_messages_correlation_id"`);
    await queryRunner.query(`DROP INDEX "IDX_dlq_messages_message_id"`);
    await queryRunner.query(`DROP TABLE "dlq_messages"`);
    await queryRunner.query(`DROP INDEX "IDX_events_correlation_id"`);
    await queryRunner.query(`DROP INDEX "UQ_events_event_id"`);
    await queryRunner.query(`DROP TABLE "events"`);
    await queryRunner.query(`DROP TYPE "events_status_enum"`);
  }
}
