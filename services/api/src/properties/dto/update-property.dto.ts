import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsBoolean,
  IsArray,
  IsIn,
  MaxLength,
  MinLength,
  Min,
  Max,
  ArrayMaxSize,
} from 'class-validator';
import {
  PROPERTY_NAME_MAX_LENGTH,
  PROPERTY_DESCRIPTION_MAX_LENGTH,
  ADDRESS_STREET_MAX_LENGTH,
  ADDRESS_CITY_MAX_LENGTH,
  ADDRESS_STATE_MAX_LENGTH,
  ADDRESS_POSTAL_CODE_MAX_LENGTH,
  FORMATTED_ADDRESS_MAX_LENGTH,
  ACCESS_INSTRUCTIONS_MAX_LENGTH,
  SPECIAL_REQUIREMENT_ITEM_MAX_LENGTH,
  SPECIAL_REQUIREMENTS_MAX_COUNT,
  CHECKLIST_ITEM_MAX_LENGTH,
  CHECKLIST_ITEMS_MAX_COUNT,
  SUPPORTED_PROPERTY_TYPES,
  SUPPORTED_COUNTRIES,
  PROPERTY_MAX_SQM,
  PROPERTY_MAX_BEDROOMS,
  PROPERTY_MAX_BATHROOMS,
} from '../properties.constants';

/**
 * DTO for updating an existing property.
 * Used by PATCH /properties/:id.
 * All fields are optional (partial update).
 * Validates constraints: sqm > 0 and <= 10000, bedrooms >= 0 and <= 50, bathrooms >= 1 and <= 20.
 */
export class UpdatePropertyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(PROPERTY_NAME_MAX_LENGTH)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn([...SUPPORTED_PROPERTY_TYPES], {
    message: 'property.error.invalid_type',
  })
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(PROPERTY_DESCRIPTION_MAX_LENGTH)
  description?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(ADDRESS_STREET_MAX_LENGTH)
  addressStreet?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(ADDRESS_CITY_MAX_LENGTH)
  addressCity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(ADDRESS_STATE_MAX_LENGTH)
  addressState?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(ADDRESS_POSTAL_CODE_MAX_LENGTH)
  addressPostalCode?: string | null;

  @IsOptional()
  @IsString()
  @IsIn([...SUPPORTED_COUNTRIES], {
    message: 'property.error.unsupported_country',
  })
  addressCountry?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90, { message: 'property.error.invalid_coordinates' })
  @Max(90, { message: 'property.error.invalid_coordinates' })
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180, { message: 'property.error.invalid_coordinates' })
  @Max(180, { message: 'property.error.invalid_coordinates' })
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(FORMATTED_ADDRESS_MAX_LENGTH)
  formattedAddress?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(PROPERTY_MAX_SQM)
  squareMeters?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PROPERTY_MAX_BEDROOMS)
  bedrooms?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(PROPERTY_MAX_BATHROOMS)
  bathrooms?: number;

  @IsOptional()
  @IsInt()
  floorNumber?: number | null;

  @IsOptional()
  @IsBoolean()
  hasParking?: boolean;

  @IsOptional()
  @IsBoolean()
  hasElevator?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(SPECIAL_REQUIREMENT_ITEM_MAX_LENGTH, { each: true })
  @ArrayMaxSize(SPECIAL_REQUIREMENTS_MAX_COUNT)
  specialRequirements?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(CHECKLIST_ITEM_MAX_LENGTH, { each: true })
  @ArrayMaxSize(CHECKLIST_ITEMS_MAX_COUNT)
  checklistItems?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(ACCESS_INSTRUCTIONS_MAX_LENGTH)
  accessInstructions?: string | null;
}
