import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';

// Mirrors the varchar(255) columns on the events table: an oversized value
// must die here with a 400, not on the worker's INSERT.
const MAX_ID_LENGTH = 255;

export class OrderWebhookDto {
  @ApiProperty({
    example: 'order-123',
    maxLength: MAX_ID_LENGTH,
    description: 'Idempotency key: a repeated id takes effect exactly once',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ID_LENGTH)
  event_id!: string;

  @ApiProperty({ example: 'order.created', maxLength: MAX_ID_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ID_LENGTH)
  event_type!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: { amount: 4200 },
    description: 'Opaque partner payload, stored as jsonb',
  })
  @IsObject()
  payload!: Record<string, unknown>;
}
