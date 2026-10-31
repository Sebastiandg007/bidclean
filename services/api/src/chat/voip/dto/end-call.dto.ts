import { IsIn, IsOptional } from 'class-validator';

import { EndReason } from '../voip.constants';

/**
 * Body for `POST /chat/conversations/:id/calls/:callId/end`.
 *
 * A participant-driven end is always a HANGUP (Req 2.4) — the server never trusts a client to
 * declare a timeout/error cause. `endReason` is therefore optional and, when present, must be
 * `HANGUP`; the service derives the authoritative terminal status/reason itself.
 */
export class EndCallDto {
  @IsOptional()
  @IsIn([EndReason.HANGUP])
  readonly endReason?: typeof EndReason.HANGUP;
}
