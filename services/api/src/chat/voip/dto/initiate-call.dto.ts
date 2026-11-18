import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

import { MediaKind } from '../voip.constants';

/**
 * Body for `POST /chat/conversations/:id/calls`.
 *
 * `clientCallId` is a client-generated UUID that makes initiate idempotent (a retry returns the
 * same RINGING call rather than creating a second). `mediaKind` selects audio or video; video is
 * capability-gated server-side and degrades to audio when disabled.
 */
export class InitiateCallDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  readonly clientCallId!: string;

  @IsIn([MediaKind.AUDIO, MediaKind.VIDEO])
  readonly mediaKind!: MediaKind;
}
