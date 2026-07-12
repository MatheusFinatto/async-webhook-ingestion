import { MigrationInterface, QueryRunner } from 'typeorm';

export class UniqueDlqMessageId1783547400000 implements MigrationInterface {
  name = 'UniqueDlqMessageId1783547400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_dlq_messages_message_id"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_dlq_messages_message_id" ON "dlq_messages" ("message_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_dlq_messages_message_id"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_dlq_messages_message_id" ON "dlq_messages" ("message_id")`,
    );
  }
}
