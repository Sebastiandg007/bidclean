import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { randomUUID } from 'crypto';

import {
  VIDEO_VERIFICATION_MINIO_BUCKET,
  VIDEO_VERIFICATION_UPLOAD_URL_TTL_SECONDS,
} from '../video-verification.constants';
import { InspectResult, UploadTarget } from '../video-verification.types';
import { VideoDurationProbe } from './video-duration.probe';

/** Default HTTPS port (mirrors kyc/voice storage URL parsing). */
const DEFAULT_HTTPS_PORT = 443;
/** Default MinIO port. */
const DEFAULT_MINIO_PORT = 9000;
/** Milliseconds per second for expiry calculation. */
const MS_PER_SECOND = 1000;

/**
 * Verification arrival-video storage service (mirrors `KycStorageService` / `VoiceNoteStorageService`,
 * `minio` client).
 *
 * Owns the private, server-side-encrypted `verification-videos` bucket lifecycle. Access is
 * deliberately MORE minimal than voice notes (the artifact is biometric-adjacent): the Cleaner has
 * upload-only via a single-object pre-signed PUT, and the API worker has server-side read for
 * processing. There is DELIBERATELY NO playback/download presign in v1 — no client ever receives a
 * GET URL. `inspectObject` is the AUTHORITATIVE validation of a stored object (real size +
 * content-type from `statObject`, real duration probed from the fetched bytes; client-declared
 * metadata is advisory only). `deleteObjectSafe` is idempotent. Never logs video bytes.
 */
@Injectable()
export class VerificationStorageService implements OnModuleInit {
  private readonly logger = new Logger(VerificationStorageService.name);
  private readonly minioClient: Minio.Client;
  private readonly bucketName: string;
  private readonly uploadTtlSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly durationProbe: VideoDurationProbe,
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

    this.bucketName = VIDEO_VERIFICATION_MINIO_BUCKET;
    this.uploadTtlSeconds = VIDEO_VERIFICATION_UPLOAD_URL_TTL_SECONDS;
  }

  /** Ensure the private verification-videos bucket exists on startup. */
  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  /**
   * Generate an unguessable, path-prefixed object key. Public so the caller can PERSIST the upload
   * grant bound to this key BEFORE the pre-signed URL is minted (design ordering: grant first).
   * The client never chooses the key.
   */
  generateObjectKey(): string {
    const id = randomUUID();
    // Shard by the first two hex chars to avoid a single flat prefix; the full UUID is unguessable.
    return `${id.slice(0, 2)}/${id}`;
  }

  /**
   * Mint a short-lived pre-signed PUT URL scoped to one already-generated key. The URL grants a
   * single PUT — never list, delete, or GET on the bucket.
   */
  async presignUploadTarget(objectKey: string): Promise<UploadTarget> {
    const uploadUrl = await this.minioClient.presignedPutObject(
      this.bucketName,
      objectKey,
      this.uploadTtlSeconds,
    );
    return {
      objectKey,
      uploadUrl,
      expiresAt: this.expiryFromNow(this.uploadTtlSeconds),
    };
  }

  /**
   * Download the stored object as a buffer (Option A: the worker sends the bytes to the AI service,
   * which is given no storage access). Returns `null` when the object is missing.
   */
  async readObject(objectKey: string): Promise<Buffer | null> {
    try {
      const stream = await this.minioClient.getObject(this.bucketName, objectKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks);
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Authoritatively inspect a stored object: real size + content-type from `statObject`, real
   * duration probed from the fetched bytes. `exists=false` when the object is missing;
   * `durationMs=null` when the bytes could not be probed as valid video.
   */
  async inspectObject(objectKey: string): Promise<InspectResult> {
    let stat: Minio.BucketItemStat;
    try {
      stat = await this.minioClient.statObject(this.bucketName, objectKey);
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        return { exists: false, sizeBytes: 0, contentType: '', durationMs: null };
      }
      throw error;
    }

    const contentType = this.resolveContentType(stat);
    const buffer = await this.readObject(objectKey);
    if (buffer === null) {
      return { exists: false, sizeBytes: 0, contentType: '', durationMs: null };
    }
    const durationMs = this.durationProbe.probe(buffer, contentType);

    return { exists: true, sizeBytes: stat.size, contentType, durationMs };
  }

  /** Remove an object from MinIO. Idempotent — an already-deleted object is a no-op. */
  async deleteObjectSafe(objectKey: string): Promise<void> {
    try {
      await this.minioClient.removeObject(this.bucketName, objectKey);
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        this.logger.warn(`Verification video already deleted (not found): ${objectKey}`);
        return;
      }
      throw error;
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /** Resolve the content type from a stat result (statObject exposes it via metaData). */
  private resolveContentType(stat: Minio.BucketItemStat): string {
    const meta = stat.metaData as Record<string, string> | undefined;
    return meta?.['content-type'] ?? meta?.['Content-Type'] ?? '';
  }

  /** ISO expiry timestamp `ttlSeconds` from now. */
  private expiryFromNow(ttlSeconds: number): string {
    return new Date(Date.now() + ttlSeconds * MS_PER_SECOND).toISOString();
  }

  /** Create the bucket if it doesn't exist (private by default; MinIO buckets have no public read). */
  private async ensureBucketExists(): Promise<void> {
    const exists = await this.minioClient.bucketExists(this.bucketName);
    if (!exists) {
      this.logger.log(`Creating verification-videos bucket: ${this.bucketName}`);
      await this.minioClient.makeBucket(this.bucketName);
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
