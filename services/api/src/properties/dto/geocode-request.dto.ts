import {
  IsString,
  IsNumber,
  IsIn,
  MaxLength,
  MinLength,
  Min,
  Max,
} from 'class-validator';
import {
  GEOCODE_QUERY_MAX_LENGTH,
  SUPPORTED_COUNTRIES,
} from '../properties.constants';

/**
 * DTO for forward geocoding request.
 * Used by POST /properties/geocode.
 */
export class ForwardGeocodeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(GEOCODE_QUERY_MAX_LENGTH, { message: 'property.error.geocode_query_too_long' })
  address!: string;

  @IsString()
  @IsIn([...SUPPORTED_COUNTRIES], {
    message: 'property.error.unsupported_country',
  })
  country!: string;
}

/**
 * DTO for reverse geocoding request.
 * Used by POST /properties/reverse-geocode.
 */
export class ReverseGeocodeDto {
  @IsNumber()
  @Min(-90, { message: 'property.error.invalid_coordinates' })
  @Max(90, { message: 'property.error.invalid_coordinates' })
  lat!: number;

  @IsNumber()
  @Min(-180, { message: 'property.error.invalid_coordinates' })
  @Max(180, { message: 'property.error.invalid_coordinates' })
  lng!: number;
}
