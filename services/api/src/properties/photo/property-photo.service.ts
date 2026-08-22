import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PropertyPhoto } from '../entities/property-photo.entity';

/**
 * Property photo service.
 * Handles photo upload (MinIO with AES-256 encryption), resize (sharp),
 * signed URL generation, deletion, max count validation,
 * and transactional display_order management with SELECT FOR UPDATE.
 *
 * Stores mime_type and file_size_bytes alongside storage reference
 * for auditing and validation.
 */
@Injectable()
export class PropertyPhotoService {
  constructor(
    @InjectRepository(PropertyPhoto)
    private readonly _photoRepo: Repository<PropertyPhoto>,
    private readonly _dataSource: DataSource,
    private readonly _configService: ConfigService,
  ) {}

  /** @internal Placeholder to satisfy noUnusedLocals until methods are implemented */
  protected get dependencies(): unknown[] {
    return [this._photoRepo, this._dataSource, this._configService];
  }
}
