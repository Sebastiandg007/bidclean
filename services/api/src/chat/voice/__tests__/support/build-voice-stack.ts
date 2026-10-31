import { DataSource } from 'typeorm';

import { NegotiationRepository } from '../../../../negotiation/negotiation.repository';
import { ChatRepository } from '../../../chat.repository';
import {
  ChatRealtimePublisher,
  ChatService,
  VoiceTranscriptionEnqueuer,
} from '../../../chat.service';
import { AudioDurationProbe } from '../../audio-duration.probe';
import { ObjectDeletionRepository } from '../../object-deletion.repository';
import { UploadGrantRepository } from '../../upload-grant.repository';
import { VoiceNoteRepository } from '../../voice-note.repository';
import { VoiceNoteStorageService } from '../../voice-note-storage.service';
import { InspectResult, UploadTarget } from '../../voice.types';
import { InMemoryVoiceDataSource } from './in-memory-voice-data-source';

/** A controllable storage double: records objects and returns configurable inspect results. */
export class FakeVoiceStorage {
  private keyCounter = 0;
  readonly objects = new Map<string, InspectResult>();
  readonly deleted: string[] = [];
  listResult: string[] = [];

  generateObjectKey(): string {
    this.keyCounter += 1;
    return `k${this.keyCounter}/object`;
  }

  async presignUploadTarget(objectKey: string): Promise<UploadTarget> {
    return {
      objectKey,
      uploadUrl: `https://minio.test/put/${objectKey}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }

  async getPlaybackTarget(objectKey: string): Promise<{ playbackUrl: string; expiresAt: string }> {
    return {
      playbackUrl: `https://minio.test/get/${objectKey}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    };
  }

  /** Register a stored object with the given authoritative properties. */
  putObject(objectKey: string, result: Partial<InspectResult>): void {
    this.objects.set(objectKey, {
      exists: true,
      sizeBytes: 1024,
      contentType: 'audio/mp4',
      durationMs: 5000,
      ...result,
    });
  }

  async inspectObject(objectKey: string): Promise<InspectResult> {
    return (
      this.objects.get(objectKey) ?? {
        exists: false,
        sizeBytes: 0,
        contentType: '',
        durationMs: null,
      }
    );
  }

  async getObject(objectKey: string): Promise<Buffer | null> {
    return this.objects.has(objectKey) ? Buffer.from('audio') : null;
  }

  async deleteObjectSafe(objectKey: string): Promise<void> {
    this.deleted.push(objectKey);
    this.objects.delete(objectKey);
  }

  async listObjectsOlderThan(_olderThan: Date, limit: number): Promise<string[]> {
    return this.listResult.slice(0, limit);
  }
}

const THREAD = { id: 'thread-1', offerId: 'offer-1', hostId: 'host-1', cleanerId: 'cleaner-1' };

export interface VoiceStack {
  service: ChatService;
  db: InMemoryVoiceDataSource;
  storage: FakeVoiceStorage;
  grantRepository: UploadGrantRepository;
  voiceNoteRepository: VoiceNoteRepository;
  objectDeletionRepository: ObjectDeletionRepository;
  publisher: jest.Mocked<ChatRealtimePublisher>;
  enqueuer: jest.Mocked<VoiceTranscriptionEnqueuer>;
}

/** Build a ChatService wired to the in-memory voice DataSource + a controllable storage double. */
export function buildVoiceStack(): VoiceStack {
  const db = new InMemoryVoiceDataSource();
  const dataSource = db as unknown as DataSource;
  const chatRepo = new ChatRepository(dataSource);
  const grantRepository = new UploadGrantRepository(dataSource);
  const voiceNoteRepository = new VoiceNoteRepository(dataSource);
  const objectDeletionRepository = new ObjectDeletionRepository(dataSource);
  const storage = new FakeVoiceStorage();
  const publisher: jest.Mocked<ChatRealtimePublisher> = {
    publish: jest.fn().mockResolvedValue(true),
  };
  const enqueuer: jest.Mocked<VoiceTranscriptionEnqueuer> = {
    add: jest.fn().mockResolvedValue(undefined),
  };
  const negotiation = {
    findThreadById: jest.fn().mockResolvedValue(THREAD),
    isThreadMatched: jest.fn().mockResolvedValue(true),
  } as unknown as NegotiationRepository;

  const service = new ChatService(
    chatRepo,
    negotiation,
    publisher,
    grantRepository,
    voiceNoteRepository,
    storage as unknown as VoiceNoteStorageService,
    enqueuer,
  );

  return {
    service,
    db,
    storage,
    grantRepository,
    voiceNoteRepository,
    objectDeletionRepository,
    publisher,
    enqueuer,
  };
}

/** Open the canonical matched conversation and return its id. */
export async function openVoiceConversation(stack: VoiceStack): Promise<string> {
  const conversation = await stack.service.openConversation({
    threadId: THREAD.id,
    userId: THREAD.hostId,
  });
  return conversation.id;
}

/** Also expose the AudioDurationProbe for tests that need a real probe. */
export function makeProbe(): AudioDurationProbe {
  return new AudioDurationProbe();
}

export { THREAD };