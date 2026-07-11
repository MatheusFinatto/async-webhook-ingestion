import { IsNotEmpty, IsObject, IsString, MaxLength } from 'class-validator';

// Mirrors the varchar(255) columns on the events table: an oversized value
// must die here with a 400, not on the worker's INSERT.
const MAX_ID_LENGTH = 255;

export class OrderWebhookDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ID_LENGTH)
  event_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_ID_LENGTH)
  event_type!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}
