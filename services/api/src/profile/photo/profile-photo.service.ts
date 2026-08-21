import { Injectable, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SignedPhotoUrl } from './profile-photo.types';

/**
 * Profile photo service.
 * Handles photo upload to MinIO with encryption, resize via sharp,
 * signed URL generation, and old photo deletion on replacement.
 */
@Injectable()
export class ProfilePhotoService {
  constructor(private readonly configService: ConfigService) {}

  async uploadPhoto(_userId: string, _file: Buffer, _mimeType: string): Promise<string> {
    void this.configService;
    throw new NotImplementedException();
  }

  async deletePhoto(_userId: string): Promise<void> {
    throw new NotImplementedException();
  }

  async getSignedUrl(_storageKey: string): Promise<SignedPhotoUrl> {
    throw new NotImplementedException();
  }
}
