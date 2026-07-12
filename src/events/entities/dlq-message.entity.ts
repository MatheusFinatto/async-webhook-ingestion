import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('dlq_messages')
export class DlqMessage {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // Unique so an at-least-once redelivery of the same dead letter is ignored
  // on insert; NULLs (dead letters with no usable id) stay unconstrained.
  @Index('UQ_dlq_messages_message_id', { unique: true })
  @Column({ name: 'message_id', type: 'varchar', length: 255, nullable: true })
  messageId!: string | null;

  @Index('IDX_dlq_messages_correlation_id')
  @Column({ name: 'correlation_id', type: 'varchar', length: 255 })
  correlationId!: string;

  @Column({ name: 'event_id', type: 'varchar', length: 255, nullable: true })
  eventId!: string | null;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'payload', type: 'text', nullable: true })
  payload!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
