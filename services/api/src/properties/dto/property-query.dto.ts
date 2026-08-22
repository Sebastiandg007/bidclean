import {
  IsOptional,
  IsString,
  IsInt,
  IsIn,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  PROPERTY_LIST_MAX_PAGE_SIZE,
  PROPERTY_LIST_DEFAULT_PAGE_SIZE,
  PROPERTY_NAME_MAX_LENGTH,
  SUPPORTED_PROPERTY_TYPES,
  ALLOWED_SORT_FIELDS,
} from '../properties.constants';

/**
 * DTO for property list query parameters.
 * Used by GET /properties (pagination + filters).
 */
export class PropertyQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PROPERTY_LIST_MAX_PAGE_SIZE)
  pageSize?: number = PROPERTY_LIST_DEFAULT_PAGE_SIZE;

  @IsOptional()
  @IsString()
  @MaxLength(PROPERTY_NAME_MAX_LENGTH)
  search?: string;

  @IsOptional()
  @IsString()
  @IsIn([...SUPPORTED_PROPERTY_TYPES], {
    message: 'property.error.invalid_type',
  })
  type?: string;

  @IsOptional()
  @IsString()
  @IsIn([...ALLOWED_SORT_FIELDS], {
    message: 'property.error.invalid_sort',
  })
  sortBy?: string = 'updated_at';

  @IsOptional()
  @IsString()
  @IsIn(['ASC', 'DESC'])
  sortOrder?: 'ASC' | 'DESC' = 'DESC';
}
