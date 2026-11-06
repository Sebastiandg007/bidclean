import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as Minio from 'minio';

/** Default HTTPS port (mirrors kyc/voice storage URL parsing). */
const DEFAULT_HTTPS_PORT = 443;
/** Default MinIO port. */
const DEFAULT_MINIO_PORT = 9000;

/**
 * KYC reference reader (read-only bridge to kyc-verification, Spec 3).
 *
 * Resolves the Cleaner's latest VERIFIED KYC selfie storage key (the identity authority derives
 * current status from the latest `kyc_verifications` attempt) and reads that object read-only from
 * the KYC bucket for use as the reference face in the arrival comparison. It NEVER mutates KYC and
 * never re-runs OCR/liveness. Returns `null` when no VERIFIED selfie exists — a non-fatal, advisory
 * outcome that drives the INCONCLUSIVE/FAILED path (P12). Never logs the reference bytes.
 */
@Injectable()
export class KycReferenceReader {
  private readonly logger = new Logger(KycReferenceReader.name);
  private readonly minioClient: Minio.Client;
  private readonly kycBucket: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {
    const endpoint = this.configService.getOrThrow<string>('MINIO_ENDPOINT');
    const parsedUrl = new URL(endpoint);

    this.minioClient = new Minio.Client({
      endPoint: parsedUrl.hostname,
      port:
        parseInt(parsedUrl.port, 10) ||
        (parsedUrl.protocol === 'https:' ? DEFAULT_HTTPS_PORT : DEFAULT_MINIO_PORT),
      useSSL: parsedUrl.protocol === 'https:',
      accessKey: this.configService.getOrThrow<string>('MINIO_ROOT_USER'),
      secretKey: this.configService.getOrThrow<string>('MINIO_ROOT_PASSWORD'),
    });
    this.kycBucket = this.configService.getOrThrow<string>('KYC_MINIO_BUCKET');
  }

  /**
   * Read the Cleaner's VERIFIED KYC selfie bytes, or `null` when none exists (non-fatal). Resolves
   * the latest VERIFIED attempt's `selfie_storage_key` first, then reads that object read-only.
   */
  async getVerifiedSelfie(cleanerId: string): Promise<Buffer | null> {
    const key = await this.resolveVerifiedSelfieKey(cleanerId);
    if (!key) {
      return null;
    }
    return this.readObject(key);
  }

  /** Resolve the storage key of the latest VERIFIED selfie for the Cleaner, or null. */
  private async resolveVerifiedSelfieKey(cleanerId: string): Promise<string | null> {
    const rows = await this.dataSource.query<Array<{ selfie_storage_key: string | null }>>(
      `SELECT "selfie_storage_key"
       FROM "kyc_verifications"
       WHERE "user_id" = $1 AND "status" = 'VERIFIED' AND "selfie_storage_key" IS NOT NULL
       ORDER BY "attempt_number" DESC
       LIMIT 1`,
      [cleanerId],
    );
    return rows[0]?.selfie_storage_key ?? null;
  }

  /** Read an object from the KYC bucket read-only; null when missing. */
  private async readObject(key: string): Promise<Buffer | null> {
    try {
      const stream = await this.minioClient.getObject(this.kycBucket, key);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks);
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        this.logger.warn('VERIFIED KYC selfie object missing for a cleaner (treated as no reference)');
        return null;
      }
      throw error;
    }
  }

  /** Determine whether an error represents a MinIO "not found" condition. */
  private isNotFoundError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code: string }).code;
      return code === 'NoSuchKey' || code === 'NotFound';
    }
    return false;
  }
}
