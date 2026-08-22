import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';

/**
 * DTO for reordering property photos.
 * Used by PATCH /properties/:id/photos/order.
 * Accepts an array of photo IDs in the desired display order.
 */
export class ReorderPhotosDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  photoIds!: string[];
}
