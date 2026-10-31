import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

import { FAVORITES_LIST_MAX_LIMIT } from '../favorites.constants';

/** Query for `GET /favorites` — keyset pagination (`limit` clamped, opaque `cursor`). */
export class ListFavoritesQueryDto {
  /** Page size, in [1, FAVORITES_LIST_MAX_LIMIT]; omitted → the service default. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FAVORITES_LIST_MAX_LIMIT)
  limit?: number;

  /** Opaque keyset cursor from the previous page's `nextCursor`; omitted → the first page. */
  @IsOptional()
  @IsString()
  cursor?: string;
}
