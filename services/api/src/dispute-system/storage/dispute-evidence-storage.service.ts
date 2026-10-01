import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import sharp from 'sharp';
import { randomUUID } from 'crypto';

import {
  DISPUTE_EVIDENCE_MINIO_BUCKET,
  DISPUTE_EVIDENCE_PLAYBACK_URL_TTL_SECONDS,
  DISPUTE_EVIDENCE_UPLOAD_URL_TTL_SECONDS,
} from '../dispute.constants';

/** Default HTTPS port (mirrors the checklist-photos storage URL parsing). */
const DEFAULT_HTTPS_PORT = 443;
/** Default MinIO port. */
const DEFAULT_MINIO_PORT = 9000;
/** Milliseconds per second for expiry calculation. */
const MS_PER_SECOND = 1000;

/** A minted pre-signed PUT target. */
export interface UploadTarget {
  readonly objectKey: string;
  readonly uploadUrl: string;
  readonly expiresAt: string;
}

/** A minted pre-signed GET target. */
export interface PlaybackTarget {
  readonly playbackUrl: string;
  readonly expiresAt: string;
}

/** The authoritative result of inspecting a stored object. */
export interface InspectResult {
  readonly exists: boolean;
  readonly sizeBytes: number;
  readonly contentType: string;
  readonly width: number | null;
  readonly height: number | null;
}

/**
 * DisputeEvidenceStorageService (mirrors `ChecklistStorageService`, `minio` client) — Spec 21.
 *
 * Owns the private `dispute-evidence` MinIO bucket lifecycle and all pre-signed access. Evidence
 * bytes never transit the API: the participant PUTs directly to a single-object pre-signed upload
 * URL, and a participant/resolver GETs a short-lived pre-signed playback URL. `inspectObject` is the
 * AUTHORITATIVE validation (real size/content-type from `statObject`, real dimensions probed from the
 * fetched bytes; client metadata advisory). `deleteObjectSafe` is idempotent. Never logs object keys
 * or bytes. MinIO credentials come from the shared `MINIO_*` config — never shipped to the client.
 */
@Injectable()
export class DisputeEvidenceStorageService implements OnModuleInit {
  private readonly logger = new Logger(DisputeEvidenceStorageService.name);
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

    this.bucketName = DISPUTE_EVIDENCE_MINIO_BUCKET;
    this.uploadTtlSeconds = DISPUTE_EVIDENCE_UPLOAD_URL_TTL_SECONDS;
    this.playbackTtlSeconds = DISPUTE_EVIDENCE_PLAYBACK_URL_TTL_SECONDS;
  }

  /** Ensure the private dispute-evidence bucket exists on startup. */
  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  /**
   * Generate an unguessable, path-prefixed object key. The caller PERSISTS the upload grant bound to
   * this key BEFORE the pre-signed URL is minted (grant first). The client never chooses the key.
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
    return { objectKey, uploadUrl, expiresAt: this.expiryFromNow(this.uploadTtlSeconds) };
  }

  /** Mint a fresh short-lived pre-signed GET URL for playback of a stored object. */
  async getPlaybackTarget(objectKey: string): Promise<PlaybackTarget> {
    const playbackUrl = await this.minioClient.presignedGetObject(
      this.bucketName,
      objectKey,
      this.playbackTtlSeconds,
    );
    return { playbackUrl, expiresAt: this.expiryFromNow(this.playbackTtlSeconds) };
  }

  /**
   * Authoritatively inspect a stored object: real size + content-type from `statObject`, real
   * dimensions probed from the fetched bytes. `exists=false` when missing; `width/height=null` when
   * the bytes could not be probed as a valid image.
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
        this.logger.warn('Dispute evidence object already deleted (not found)');
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
      this.logger.log(`Creating dispute-evidence bucket: ${this.bucketName}`);
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
