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
  id: string;

  @Index('IDX_dlq_messages_message_id')
  @Column({ name: 'message_id', type: 'varchar', length: 255, nullable: true })
  messageId: string | null;

  @Index('IDX_dlq_messages_correlation_id')
  @Column({ name: 'correlation_id', type: 'varchar', length: 255 })
  correlationId: string;

  @Column({ name: 'event_id', type: 'varchar', length: 255, nullable: true })
  eventId: string | null;

  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'payload', type: 'text', nullable: true })
  payload: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
