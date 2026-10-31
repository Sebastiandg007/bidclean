import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import sharp from 'sharp';
import { randomUUID } from 'crypto';

import {
  CHECKLIST_PHOTO_MINIO_BUCKET,
  CHECKLIST_PHOTO_PLAYBACK_URL_TTL_SECONDS,
  CHECKLIST_PHOTO_UPLOAD_URL_TTL_SECONDS,
} from '../checklist.constants';
import { InspectResult, PlaybackTarget, UploadTarget } from '../checklist.types';

/** Default HTTPS port (mirrors PropertyPhotoService URL parsing). */
const DEFAULT_HTTPS_PORT = 443;
/** Default MinIO port. */
const DEFAULT_MINIO_PORT = 9000;
/** Milliseconds per second for expiry calculation. */
const MS_PER_SECOND = 1000;

/**
 * Checklist evidence storage service (mirrors `VoiceNoteStorageService`, `minio` client).
 *
 * Owns the private `checklist-photos` MinIO bucket lifecycle and all pre-signed access. Photo bytes
 * never transit the API: the Cleaner PUTs directly to a single-object pre-signed upload URL, and a
 * participant GETs a short-lived pre-signed playback URL. `inspectObject` is the AUTHORITATIVE
 * validation of a stored object — real size/content-type from `statObject`, real dimensions probed
 * from the fetched bytes (client-declared metadata is advisory only). `deleteObjectSafe` is
 * idempotent. Never logs photo bytes or object contents.
 */
@Injectable()
export class ChecklistStorageService implements OnModuleInit {
  private readonly logger = new Logger(ChecklistStorageService.name);
  private readonly minioClient: Minio.Client;
  private readonly bucketName: string;
  private readonly uploadTtlSeconds: number;
  private readonly playbackTtlSeconds: number;

  constructor(private readonly configService: ConfigService) {
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

    this.bucketName = CHECKLIST_PHOTO_MINIO_BUCKET;
    this.uploadTtlSeconds = CHECKLIST_PHOTO_UPLOAD_URL_TTL_SECONDS;
    this.playbackTtlSeconds = CHECKLIST_PHOTO_PLAYBACK_URL_TTL_SECONDS;
  }

  /** Ensure the private checklist-photos bucket exists on startup. */
  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  /**
   * Generate an unguessable, path-prefixed object key. Public so the caller can PERSIST the upload
   * grant bound to this key BEFORE the pre-signed URL is minted (design ordering: grant first). The
   * client never chooses the key.
   */
  generateObjectKey(): string {
    const id = randomUUID();
    return `${id.slice(0, 2)}/${id}`;
  }

  /** Mint a short-lived pre-signed PUT URL scoped to one already-generated key (single PUT). */
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

  /** Mint a fresh short-lived pre-signed GET URL for playback of a stored object. */
  async getPlaybackTarget(objectKey: string): Promise<PlaybackTarget> {
    const playbackUrl = await this.minioClient.presignedGetObject(
      this.bucketName,
      objectKey,
      this.playbackTtlSeconds,
    );
    return {
      playbackUrl,
      expiresAt: this.expiryFromNow(this.playbackTtlSeconds),
    };
  }

  /**
   * Authoritatively inspect a stored object: real size + content-type from `statObject`, real
   * dimensions probed from the fetched bytes. `exists=false` when missing; `width/height=null`
   * when the bytes could not be probed as a valid image.
   */
  async inspectObject(objectKey: string): Promise<InspectResult> {
    let stat: Minio.BucketItemStat;
    try {
      stat = await this.minioClient.statObject(this.bucketName, objectKey);
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        return { exists: false, sizeBytes: 0, contentType: '', width: null, height: null };
      }
      throw error;
    }

    const contentType = this.resolveContentType(stat);
    const buffer = await this.getObject(objectKey);
    if (buffer === null) {
      return { exists: false, sizeBytes: 0, contentType: '', width: null, height: null };
    }
    const dimensions = await this.probeDimensions(buffer);

    return {
      exists: true,
      sizeBytes: stat.size,
      contentType,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
    };
  }

  /** Remove an object from MinIO. Idempotent — an already-deleted object is a no-op. */
  async deleteObjectSafe(objectKey: string): Promise<void> {
    try {
      await this.minioClient.removeObject(this.bucketName, objectKey);
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        this.logger.warn('Checklist photo object already deleted (not found)');
        return;
      }
      throw error;
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /** Download the stored object as a buffer (bounded read for dimension probing). Null if missing. */
  private async getObject(objectKey: string): Promise<Buffer | null> {
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

  /** Probe real image dimensions from bytes; null when the bytes are not a valid image. */
  private async probeDimensions(
    buffer: Buffer,
  ): Promise<{ width: number; height: number } | null> {
    try {
      const metadata = await sharp(buffer).metadata();
      if (typeof metadata.width === 'number' && typeof metadata.height === 'number') {
        return { width: metadata.width, height: metadata.height };
      }
      return null;
    } catch {
      return null;
    }
  }

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
      this.logger.log(`Creating checklist-photos bucket: ${this.bucketName}`);
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
