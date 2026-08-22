import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Property } from './entities/property.entity';

/**
 * Properties repository.
 * Encapsulates all database queries for the properties module.
 *
 * CRITICAL: All queries enforce WHERE user_id = :userId AND deleted_at IS NULL
 * as the PRIMARY ownership/soft-delete enforcement layer.
 *
 * The dedicated findPublicProperty method uses an explicit column list
 * that NEVER returns address_street, address_state, address_postal_code,
 * formatted_address, location, location_source, or access_instructions.
 */
@Injectable()
export class PropertiesRepository {
  constructor(
    @InjectRepository(Property)
    private readonly propertyRepo: Repository<Property>,
    private readonly dataSource: DataSource,
  ) {}

  // Query methods will be implemented in Task 10
}
