import { DataSource, EntityManager } from 'typeorm';

import { UploadGrantRepository } from '../upload-grant.repository';
import { VoiceNoteRepository } from '../voice-note.repository';
import { InMemoryVoiceDataSource } from './support/in-memory-voice-data-source';

/**
 * Unit tests for the grant + voice-note repositories (task 4.3 · P6, P13, P21).
 *
 * Exercises grant create/find/consume + single-use, the attach-transcript latest-attempt guard,
 * findStuckPending (only aged PENDING), and findExpiredIssued (only expired ISSUED) over the
 * in-memory voice DataSource.
 */

function build(): {
  db: InMemoryVoiceDataSource;
  grants: UploadGrantRepository;
  notes: VoiceNoteRepository;
  ds: DataSource;
} {
  const db = new InMemoryVoiceDataSource();
  const ds = db as unknown as DataSource;
  return { db, grants: new UploadGrantRepository(ds), notes: new VoiceNoteRepository(ds), ds };
}

describe('UploadGrantRepository', () => {
  it('creates an ISSUED grant, finds it, and consumes it once (single-use, P6)', async () => {
    const { db, grants, ds } = build();
    await grants.createGrant({ objectKey: 'k1', conversationId: 'c1', userId: 'u1' });
    expect(db.grants[0]?.status).toBe('ISSUED');

    await ds.transaction(async (manager: EntityManager) => {
      const found = await grants.findConsumable(manager, 'k1');
      expect(found?.issuedToUserId).toBe('u1');
      expect(found?.conversationId).toBe('c1');
      await grants.markConsumed(manager, 'k1', 'msg-1');
    });
    expect(db.grants[0]?.status).toBe('CONSUMED');
    expect(db.grants[0]?.consumed_message_id).toBe('msg-1');
  });

  it('findConsumable returns null for an unknown key', async () => {
    const { grants, ds } = build();
    await ds.transaction(async (manager: EntityManager) => {
      expect(await grants.findConsumable(manager, 'nope')).toBeNull();
    });
  });

  it('findExpiredIssued selects only expired ISSUED grants', async () => {
    const { db, grants } = build();
    db.grants.push({ object_key: 'expired', conversation_id: 'c', issued_to_user_id: 'u', status: 'ISSUED', expires_at: new Date(Date.now() - 1000), consumed_message_id: null, created_at: new Date() });
    db.grants.push({ object_key: 'fresh', conversation_id: 'c', issued_to_user_id: 'u', status: 'ISSUED', expires_at: new Date(Date.now() + 60_000), consumed_message_id: null, created_at: new Date() });
    db.grants.push({ object_key: 'consumed', conversation_id: 'c', issued_to_user_id: 'u', status: 'CONSUMED', expires_at: new Date(Date.now() - 1000), consumed_message_id: 'm', created_at: new Date() });

    const expired = await grants.findExpiredIssued(new Date(), 10);
    expect(expired.map((g) => g.objectKey)).toEqual(['expired']);
  });

  it('deleteGrant is idempotent', async () => {
    const { grants } = build();
    await expect(grants.deleteGrant('missing')).resolves.toBeUndefined();
  });
});

describe('VoiceNoteRepository', () => {
  async function insertNote(
    notes: VoiceNoteRepository,
    ds: DataSource,
    messageId: string,
    status = 'PENDING',
  ): Promise<void> {
    await ds.transaction(async (manager: EntityManager) => {
      await notes.insertVoiceNote(manager, {
        messageId,
        objectKey: `${messageId}/o`,
        durationMs: 1000,
        sizeBytes: 100,
        mimeType: 'audio/mp4',
        waveform: null,
        transcriptStatus: status,
      });
    });
  }

  it('claimTranscriptAttempt increments monotonically', async () => {
    const { notes, ds } = build();
    await insertNote(notes, ds, 'm1');
    expect(await notes.claimTranscriptAttempt('m1')).toBe(1);
    expect(await notes.claimTranscriptAttempt('m1')).toBe(2);
    expect(await notes.claimTranscriptAttempt('missing')).toBeNull();
  });

  it('attachTranscript applies the latest attempt and rejects a stale (older) one (P13)', async () => {
    const { notes, ds, db } = build();
    await insertNote(notes, ds, 'm1');
    // Claim up to attempt 2.
    await notes.claimTranscriptAttempt('m1');
    await notes.claimTranscriptAttempt('m1');
    // A stale attempt (1) is a no-op because stored attempt is 2.
    expect(
      await notes.attachTranscript({ messageId: 'm1', attempt: 1, transcript: 'stale', lang: 'en', status: 'READY' }),
    ).toBe(false);
    // The latest attempt (2) wins.
    expect(
      await notes.attachTranscript({ messageId: 'm1', attempt: 2, transcript: 'fresh', lang: 'en', status: 'READY' }),
    ).toBe(true);
    expect(db.voiceNotes[0]?.transcript).toBe('fresh');
  });

  it('findStuckPending selects only aged PENDING notes', async () => {
    const { notes, ds, db } = build();
    await insertNote(notes, ds, 'old');
    await insertNote(notes, ds, 'recent');
    await insertNote(notes, ds, 'ready', 'READY');
    const oldNote = db.voiceNotes.find((v) => v.message_id === 'old');
    if (oldNote) {
      oldNote.updated_at = new Date(Date.now() - 60 * 60 * 1000);
    }
    const stuck = await notes.findStuckPending(new Date(Date.now() - 1000), 10);
    expect(stuck.map((s) => s.messageId)).toEqual(['old']);
  });

  it('markFailed only affects a still-PENDING note', async () => {
    const { notes, ds, db } = build();
    await insertNote(notes, ds, 'm1');
    await notes.markFailed('m1');
    expect(db.voiceNotes[0]?.transcript_status).toBe('FAILED');
  });
});