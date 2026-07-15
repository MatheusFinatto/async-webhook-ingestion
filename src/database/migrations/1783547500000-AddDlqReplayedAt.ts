import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDlqReplayedAt1783547500000 implements MigrationInterface {
  name = 'AddDlqReplayedAt1783547500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "dlq_messages" ADD "replayed_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "dlq_messages" DROP COLUMN "replayed_at"`,
    );
  }
}
