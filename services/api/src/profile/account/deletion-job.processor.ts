import { Injectable, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeletionJobPayload } from '../profile.types';

/**
 * BullMQ job processor for async account deletion.
 * Executes the deletion cascade: cancel subscriptions → delete Keycloak →
 * delete MinIO → anonymize PII → mark DELETED.
 * Each step is idempotent with audit logging.
 */
@Injectable()
export class DeletionJobProcessor {
  constructor(private readonly configService: ConfigService) {}

  async process(_payload: DeletionJobPayload): Promise<void> {
    void this.configService;
    throw new NotImplementedException();
  }
}
