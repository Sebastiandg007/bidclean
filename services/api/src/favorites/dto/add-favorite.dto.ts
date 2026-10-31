import { IsUUID } from 'class-validator';

/** Body for `POST /favorites` — the Cleaner the authenticated Host wants to favorite. */
export class AddFavoriteDto {
  /** The target Cleaner's user id (a UUID). The owner (host) is resolved server-side from the JWT. */
  @IsUUID()
  cleanerId!: string;
}
