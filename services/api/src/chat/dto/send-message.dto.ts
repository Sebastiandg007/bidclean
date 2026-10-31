import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for `POST /chat/conversations/:id/messages`.
 *
 * `clientMessageId` is a client-generated id for idempotent send / optimistic reconciliation.
 * `body` bounds are validated here for a fast 400; the service re-validates (trim + max length)
 * as the authoritative check. The service enforces the business max length; the DTO caps at a
 * generous hard ceiling to reject obviously abusive payloads early.
 */
export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  readonly clientMessageId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  readonly body!: string;
}
