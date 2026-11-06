import { DataSource } from 'typeorm';
import type { Queue } from 'bullmq';

import { ObjectDeletionRepository } from '../object-deletion.repository';
import { UploadGrantRepository } from '../upload-grant.repository';
import { VoiceNoteCleanupProcessor } from '../voice-note-cleanup.processor';
import { VoiceNoteRepository } from '../voice-note.repository';
import { VoiceNoteStorageService } from '../voice-note-storage.service';
import { VOICE_TRANSCRIPTION_MAX_RETRIES } from '../voice.constants';
import { FakeVoiceStorage } from './support/build-voice-stack';
import { InMemoryVoiceDataSource } from './support/in-memory-voice-data-source';

/**
 * Unit tests for the cleanup & reconciliation sweeps (task 8.3 · P17, P18, P21).
 *
 * A: expired ISSUED grants swept (orphan object + grant deleted).
 * B: tombstones drained idempotently (object deleted, marked DONE).
 * C: reconciler deletes only aged, unreferenced objects.
 * D: stuck-PENDING re-enqueued, then FAILED after the bounded max.
 */

interface Harness {
  processor: VoiceNoteCleanupProcessor;
  db: InMemoryVoiceDataSource;
  storage: FakeVoiceStorage;
  queue: jest.Mocked<Pick<Queue, 'add'>>;
}

function build(): Harness {
  const db = new InMemoryVoiceDataSource();
  const ds = db as unknown as DataSource;
  const storage = new FakeVoiceStorage();
  const queue: jest.Mocked<Pick<Queue, 'add'>> = { add: jest.fn().mockResolvedValue(undefined) };
  const processor = new VoiceNoteCleanupProcessor(
    new UploadGrantRepository(ds),
    new VoiceNoteRepository(ds),
    new ObjectDeletionRepository(ds),
    storage as unknown as VoiceNoteStorageService,
    queue as unknown as Queue,
  );
  return { processor, db, storage, queue };
}

describe('VoiceNoteCleanupProcessor', () => {
  it('A: sweeps expired ISSUED grants and deletes their orphan objects (P17)', async () => {
    const { processor, db, storage } = build();
    db.grants.push({
      object_key: 'orphan/1',
      conversation_id: 'c',
      issued_to_user_id: 'u',
      status: 'ISSUED',
      expires_at: new Date(Date.now() - 1000),
      consumed_message_id: null,
      created_at: new Date(),
    });
    db.grants.push({
      object_key: 'fresh/1',
      conversation_id: 'c',
      issued_to_user_id: 'u',
      status: 'ISSUED',
      expires_at: new Date(Date.now() + 60_000),
      consumed_message_id: null,
      created_at: new Date(),
    });

    await processor.sweepExpiredGrants();

    expect(storage.deleted).toContain('orphan/1');
    expect(db.grants.map((g) => g.object_key)).toEqual(['fresh/1']);
  });

  it('B: drains tombstones idempotently and marks them DONE (P18)', async () => {
    const { processor, db, storage } = build();
    db.tombstones.push({
      id: 't1',
      object_key: 'dead/1',
      status: 'PENDING',
      created_at: new Date(),
      deleted_at: null,
    });

    await processor.drainTombstones();
    expect(storage.deleted).toContain('dead/1');
    expect(db.tombstones[0]?.status).toBe('DONE');

    // Idempotent: a second pass finds nothing PENDING.
    storage.deleted.length = 0;
    await processor.drainTombstones();
    expect(storage.deleted).toHaveLength(0);
  });

  it('C: reconciler deletes only aged, unreferenced objects', async () => {
    const { processor, db, storage } = build();
    storage.listResult = ['unref/1', 'referenced/1'];
    // referenced/1 is still referenced by a live voice note.
    db.voiceNotes.push({
      message_id: 'm1',
      object_key: 'referenced/1',
      transcript_status: 'READY',
      transcript_attempt: 1,
      updated_at: new Date(),
    });

    await processor.reconcileOrphanObjects();
    expect(storage.deleted).toContain('unref/1');
    expect(storage.deleted).not.toContain('referenced/1');
  });

  it('D: re-enqueues a stuck-PENDING note, then FAILs it after the bounded max (P21)', async () => {
    const { processor, db, queue } = build();
    const old = new Date(Date.now() - 10 * 60 * 60 * 1000);
    // Below the bound: re-enqueued.
    db.voiceNotes.push({
      message_id: 'm-stuck',
      object_key: 'o1',
      transcript_status: 'PENDING',
      transcript_attempt: 0,
      updated_at: old,
    });
    await processor.sweepStuckPending();
    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(db.voiceNotes[0]?.transcript_status).toBe('PENDING');

    // At the bound: marked FAILED instead of re-enqueued.
    queue.add.mockClear();
    db.voiceNotes[0]!.transcript_attempt = VOICE_TRANSCRIPTION_MAX_RETRIES;
    await processor.sweepStuckPending();
    expect(queue.add).not.toHaveBeenCalled();
    expect(db.voiceNotes[0]?.transcript_status).toBe('FAILED');
  });

  it('a full sweep never throws even when a storage delete fails', async () => {
    const { processor, db, storage } = build();
    db.tombstones.push({
      id: 't1',
      object_key: 'boom',
      status: 'PENDING',
      created_at: new Date(),
      deleted_at: null,
    });
    jest.spyOn(storage, 'deleteObjectSafe').mockRejectedValueOnce(new Error('minio down'));
    await expect(processor.sweep()).resolves.toBeUndefined();
  });
});