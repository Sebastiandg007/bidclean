import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Hard ceiling on the advisory waveform array length (UX visual only; not the audio). */
const WAVEFORM_MAX_SAMPLES = 2048;
/** Generous DTO-level ceilings; the service + storage layer enforce the authoritative bounds. */
const DECLARED_DURATION_HARD_MAX_MS = 3_600_000;
const DECLARED_SIZE_HARD_MAX_BYTES = 104_857_600;

/**
 * Body for a `type: 'VOICE'` send on `POST /chat/conversations/:id/messages`.
 *
 * `clientMessageId` drives idempotent send / optimistic reconciliation. `objectKey` references the
 * audio the client already PUT to MinIO via its upload grant. `durationMs`/`sizeBytes`/`mimeType`
 * are ADVISORY (idempotency fingerprint + UX pre-check) — the server re-inspects the stored object
 * as the authoritative source. The optional `waveform` is a small amplitude array for the player.
 * The DTO caps are generous hard ceilings to reject obviously abusive payloads early.
 */
export class SendVoiceMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  readonly clientMessageId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(512)
  readonly objectKey!: string;

  @IsInt()
  @Min(1)
  @Max(DECLARED_DURATION_HARD_MAX_MS)
  readonly durationMs!: number;

  @IsInt()
  @Min(1)
  @Max(DECLARED_SIZE_HARD_MAX_BYTES)
  readonly sizeBytes!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  readonly mimeType!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(WAVEFORM_MAX_SAMPLES)
  @IsNumber({}, { each: true })
  readonly waveform?: number[];
}