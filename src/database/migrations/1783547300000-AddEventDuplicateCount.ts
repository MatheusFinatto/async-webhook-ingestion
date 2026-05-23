import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEventDuplicateCount1783547300000 implements MigrationInterface {
  name = 'AddEventDuplicateCount1783547300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "events" ADD COLUMN "duplicate_count" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "events" DROP COLUMN "duplicate_count"`,
    );
  }
}
