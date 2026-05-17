import { IsNotEmpty, IsObject, IsString } from 'class-validator';

export class OrderWebhookDto {
  @IsString()
  @IsNotEmpty()
  event_id!: string;

  @IsString()
  @IsNotEmpty()
  event_type!: string;

  @IsObject()
  payload!: Record<string, unknown>;
}
