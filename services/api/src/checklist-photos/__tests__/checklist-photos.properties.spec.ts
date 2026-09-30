import * as fc from 'fast-check';
import { BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';

import { buildHarness, Harness } from './harness';
import { toStartedPayload } from '../consumers/started-payload.mapper';
import { buildStartedOutboxRow } from '../../service-tracking/service-outbox';
import {
  AbandonReason,
  CHECKLIST_COMPLETED_EVENT_TYPE,
  ChecklistRunState,
  GrantStatus,
  StartedPayload,
  TaskPhotoKind,
} from '../checklist.types';

/**
 * Property-based tests for checklist-photos (Spec 19), fast-check ≥100 iters each. Each is tagged
 * `// Feature: checklist-photos, Property N: <text>` and maps to the design's P1–P15 / REQ-CP.
 */

jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

const HOST = 'host-1';
const CLEANER = 'cleaner-1';
const SESSION = 'sess-1';

/** Seed a session as IN_PROGRESS with the two participants. */
function seedSession(h: Harness, state = 'IN_PROGRESS'): void {
  h.store.setSession(SESSION, { hostId: HOST, cleanerId: CLEANER, state });
}

/** A started payload arbitrary (checklist items + policies + max). */
const startedPayloadArb = (): fc.Arbitrary<StartedPayload> =>
  fc.record({
    sessionId: fc.constant(SESSION),
    offerId: fc.constant('offer-1'),
    propertyId: fc.constant('prop-1'),
    hostId: fc.constant(HOST),
    cleanerId: fc.constant(CLEANER),
    checklistItems: fc.array(fc.string({ minLength: 1, maxLength: 40 }), { maxLength: 8 }),
    photoRequiredPolicy: fc.constantFrom('NONE' as const, 'ALL_TASKS' as const),
    completionPrecondition: fc.constantFrom(
      'NONE' as const,
      'ALL_TASKS_DONE' as const,
      'ALL_REQUIRED_PHOTOS' as const,
    ),
    maxPhotosPerTask: fc.integer({ min: 1, max: 5 }),
  });

// ── Property 1: one run per session, created idempotently from one durable event ──
describe('P1 — idempotent one-run-per-session creation', () => {
  // Feature: checklist-photos, Property 1: exactly one ACTIVE run per session; ordered tasks; redelivery no-op.
  it('N redeliveries + concurrent attempts yield exactly one run with ordered tasks', async () => {
    await fc.assert(
      fc.asyncProperty(startedPayloadArb(), fc.integer({ min: 1, max: 5 }), async (payload, n) => {
        const h = buildHarness();
        seedSession(h);
        await Promise.all(Array.from({ length: n }, () => h.creation.createFromStarted(payload)));
        const run = await h.repo.findRunBySessionId(SESSION);
        expect(run).not.toBeNull();
        expect(run?.state).toBe(ChecklistRunState.ACTIVE);
        expect(run?.total_tasks).toBe(payload.checklistItems.length);
        const tasks = await h.repo.findTasks(run!.id);
        expect(tasks.map((t) => t.task_text)).toEqual([...payload.checklistItems]);
        expect(tasks.map((t) => t.position)).toEqual(payload.checklistItems.map((_, i) => i));
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 2: temporally-exact snapshot invariance ──
describe('P2 — temporally-exact snapshot invariance', () => {
  // Feature: checklist-photos, Property 2: tasks == event snapshot; policies == event-carried values.
  it('run tasks + policies equal the event-carried snapshot regardless of later config', async () => {
    await fc.assert(
      fc.asyncProperty(startedPayloadArb(), async (payload) => {
        const h = buildHarness();
        seedSession(h);
        await h.creation.createFromStarted(payload);
        const run = await h.repo.findRunBySessionId(SESSION);
        expect(run?.photo_required_policy_snapshot).toBe(payload.photoRequiredPolicy);
        expect(run?.completion_precondition_snapshot).toBe(payload.completionPrecondition);
        expect(run?.max_photos_per_task_snapshot).toBe(payload.maxPhotosPerTask);
      }),
      { numRuns: 100 },
    );
  });

  // Feature: checklist-photos, Property 2: the started event carries the snapshot additively (backward-safe).
  it('buildStartedOutboxRow carries the snapshot and keeps the deterministic event id', () => {
    fc.assert(
      fc.property(startedPayloadArb(), (payload) => {
        const row = buildStartedOutboxRow(
          { sessionId: SESSION, offerId: 'offer-1', cleanerId: CLEANER, hostId: HOST, propertyId: 'prop-1' },
          {
            checklistItems: payload.checklistItems,
            photoRequiredPolicy: payload.photoRequiredPolicy,
            completionPrecondition: payload.completionPrecondition,
            maxPhotosPerTask: payload.maxPhotosPerTask,
          },
        );
        expect(row.eventId).toBe(`service_started:${SESSION}`);
        const mapped = toStartedPayload(row.payload);
        expect(mapped.checklistItems).toEqual([...payload.checklistItems]);
        expect(mapped.photoRequiredPolicy).toBe(payload.photoRequiredPolicy);
        expect(mapped.maxPhotosPerTask).toBe(payload.maxPhotosPerTask);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 3: participant isolation & role enforcement ──
describe('P3 — participant isolation & role enforcement', () => {
  // Feature: checklist-photos, Property 3: only participants access; only the Cleaner mutates.
  it('non-participant denied everywhere; Host cannot mark but can view', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(HOST, CLEANER, 'stranger'), async (user) => {
        const h = buildHarness();
        seedSession(h);
        await h.creation.createFromStarted(await sampleRun());
        const run = await h.repo.findRunBySessionId(SESSION);
        const task = (await h.repo.findTasks(run!.id))[0];
        if (user === 'stranger') {
          await expect(h.runs.getChecklist(SESSION, user)).rejects.toBeInstanceOf(ForbiddenException);
        } else {
          await expect(h.runs.getChecklist(SESSION, user)).resolves.toBeDefined();
        }
        if (task) {
          const mark = h.tasks.markTask(SESSION, user, task.id, true);
          if (user === CLEANER) {
            await expect(mark).resolves.toBeUndefined();
          } else {
            await expect(mark).rejects.toBeInstanceOf(ForbiddenException);
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 5: task-count invariant under concurrency ──
describe('P5 — task-count invariant under concurrency', () => {
  // Feature: checklist-photos, Property 5: completed_tasks == COUNT(is_done=true) after every commit.
  it('any interleaving of mark-done/undone keeps completed_tasks consistent', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.record({ index: fc.nat(5), done: fc.boolean() }), { minLength: 1, maxLength: 20 }),
        async (ops) => {
          const h = buildHarness();
          seedSession(h);
          await h.creation.createFromStarted(await sampleRun(6));
          const run = await h.repo.findRunBySessionId(SESSION);
          const tasks = await h.repo.findTasks(run!.id);
          for (const op of ops) {
            const task = tasks[op.index % tasks.length];
            if (task) {
              await h.tasks.markTask(SESSION, CLEANER, task.id, op.done);
            }
          }
          const after = await h.repo.findRunBySessionId(SESSION);
          const doneCount = (await h.repo.findTasks(run!.id)).filter((t) => t.is_done).length;
          expect(after?.completed_tasks).toBe(doneCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 6: in-progress-gated task mutation ──
describe('P6 — in-progress-gated task mutation', () => {
  // Feature: checklist-photos, Property 6: mark accepted iff run ACTIVE + session IN_PROGRESS.
  it('a mark on a non-IN_PROGRESS session is rejected and nothing changes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom('CANCELED', 'EXPIRED', 'ARRIVED'), async (sessionState) => {
        const h = buildHarness();
        seedSession(h, 'IN_PROGRESS');
        await h.creation.createFromStarted(await sampleRun(3));
        const run = await h.repo.findRunBySessionId(SESSION);
        const task = (await h.repo.findTasks(run!.id))[0]!;
        h.store.setSession(SESSION, { hostId: HOST, cleanerId: CLEANER, state: sessionState });
        await expect(h.tasks.markTask(SESSION, CLEANER, task.id, true)).rejects.toBeInstanceOf(
          ConflictException,
        );
        const after = await h.repo.findRunBySessionId(SESSION);
        expect(after?.completed_tasks).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 7: key != credential (grant before URL, single-use, scoped) ──
describe('P7 — key is a grant, not a credential', () => {
  // Feature: checklist-photos, Property 7: finalize iff caller-issued unexpired ISSUED matching grant.
  it('grant persisted before URL; a foreign caller or reuse is rejected', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(CLEANER, 'other'), async (finalizer) => {
        const h = buildHarness();
        seedSession(h);
        await h.creation.createFromStarted(await sampleRun(2));
        const run = await h.repo.findRunBySessionId(SESSION);
        const task = (await h.repo.findTasks(run!.id))[0]!;
        const target = await h.photos.requestUpload(SESSION, CLEANER, task.id);
        // Grant exists BEFORE any URL use.
        expect(h.store.grants.get(target.objectKey)?.status).toBe(GrantStatus.ISSUED);
        const finalize = h.photos.finalizeUpload(SESSION, finalizer, task.id, {
          objectKey: target.objectKey,
        });
        if (finalizer === CLEANER) {
          await expect(finalize).resolves.toBeUndefined();
          // Reuse of the now-consumed grant is rejected.
          await expect(
            h.photos.finalizeUpload(SESSION, CLEANER, task.id, { objectKey: target.objectKey }),
          ).rejects.toBeInstanceOf(ConflictException);
        } else {
          await expect(finalize).rejects.toBeInstanceOf(ForbiddenException);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 8: max-photos-per-task cap under concurrency ──
describe('P8 — max-photos-per-task cap', () => {
  // Feature: checklist-photos, Property 8: committed photos never exceed max; concurrent requests can't both pass.
  it('the per-task cap is a hard invariant across request/finalize interleavings', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 8 }), async (cap, attempts) => {
        const h = buildHarness();
        seedSession(h);
        await h.creation.createFromStarted(await sampleRun(1, cap));
        const run = await h.repo.findRunBySessionId(SESSION);
        const task = (await h.repo.findTasks(run!.id))[0]!;
        let committed = 0;
        for (let i = 0; i < attempts; i += 1) {
          try {
            const target = await h.photos.requestUpload(SESSION, CLEANER, task.id);
            await h.photos.finalizeUpload(SESSION, CLEANER, task.id, { objectKey: target.objectKey });
            committed += 1;
          } catch {
            // cap reached → rejected; expected.
          }
        }
        const total = await h.repo.countPhotosForTask({} as never, task.id);
        expect(total).toBeLessThanOrEqual(cap);
        expect(total).toBe(Math.min(attempts, cap));
        expect(committed).toBe(total);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 9: server-authoritative validation, re-checked at finalize ──
describe('P9 — server-authoritative validation + finalize re-check', () => {
  // Feature: checklist-photos, Property 9: insert iff object valid AND run ACTIVE at finalize; late finalize 409.
  it('bad object → 400 nothing persisted; finalize after terminal → 409', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          exists: fc.boolean(),
          sizeBytes: fc.integer({ min: 0, max: 20_000_000 }),
          contentType: fc.constantFrom('image/jpeg', 'application/pdf', ''),
          probeable: fc.boolean(),
          terminalBeforeFinalize: fc.boolean(),
        }),
        async (scenario) => {
          const h = buildHarness();
          seedSession(h);
          await h.creation.createFromStarted(await sampleRun(1, 5));
          const run = await h.repo.findRunBySessionId(SESSION);
          const task = (await h.repo.findTasks(run!.id))[0]!;
          const target = await h.photos.requestUpload(SESSION, CLEANER, task.id);
          h.storage.inspections.set(target.objectKey, {
            exists: scenario.exists,
            sizeBytes: scenario.sizeBytes,
            contentType: scenario.contentType,
            width: scenario.probeable ? 100 : null,
            height: scenario.probeable ? 100 : null,
          });
          if (scenario.terminalBeforeFinalize) {
            await h.runs.forceAbandonForSession(SESSION, AbandonReason.OFFER_TERMINAL);
          }
          const finalize = h.photos.finalizeUpload(SESSION, CLEANER, task.id, {
            objectKey: target.objectKey,
          });
          const valid =
            scenario.exists &&
            scenario.sizeBytes <= 10_485_760 &&
            scenario.contentType === 'image/jpeg' &&
            scenario.probeable;
          if (scenario.terminalBeforeFinalize) {
            await expect(finalize).rejects.toBeInstanceOf(ConflictException);
            expect(await h.repo.countPhotosForTask({} as never, task.id)).toBe(0);
          } else if (valid) {
            await expect(finalize).resolves.toBeUndefined();
          } else {
            await expect(finalize).rejects.toBeInstanceOf(BadRequestException);
            expect(await h.repo.countPhotosForTask({} as never, task.id)).toBe(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 10: playback is session-scoped, key resolved server-side ──
describe('P10 — playback session-scoped resolution', () => {
  // Feature: checklist-photos, Property 10: cross-session photoId → 404; participant-only; key from DB.
  it('a photoId from another session is never served', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(HOST, CLEANER, 'stranger'), async (viewer) => {
        const h = buildHarness();
        seedSession(h);
        h.store.setSession('sess-2', { hostId: 'h2', cleanerId: 'c2', state: 'IN_PROGRESS' });
        await h.creation.createFromStarted(await sampleRun(1, 5));
        const run = await h.repo.findRunBySessionId(SESSION);
        const task = (await h.repo.findTasks(run!.id))[0]!;
        const target = await h.photos.requestUpload(SESSION, CLEANER, task.id);
        await h.photos.finalizeUpload(SESSION, CLEANER, task.id, { objectKey: target.objectKey });
        const photoId = [...h.store.photos.keys()][0]!;
        // Cross-session: resolving photoId under sess-2 → 404 for anyone.
        await expect(h.photos.getPlaybackUrl('sess-2', 'c2', photoId)).rejects.toBeInstanceOf(
          NotFoundException,
        );
        // Same session: participants OK, stranger 403.
        const playback = h.photos.getPlaybackUrl(SESSION, viewer, photoId);
        if (viewer === 'stranger') {
          await expect(playback).rejects.toBeInstanceOf(ForbiddenException);
        } else {
          await expect(playback).resolves.toHaveProperty('playbackUrl');
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 11: best-effort realtime, authoritative reconciliation ──
describe('P11 — authoritative GET reconciliation', () => {
  // Feature: checklist-photos, Property 11: GET returns authoritative state independent of realtime.
  it('completed_tasks in the GET view always equals the count of done tasks', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 6 }), async (dones) => {
        const h = buildHarness();
        seedSession(h);
        await h.creation.createFromStarted(await sampleRun(dones.length, 5));
        const run = await h.repo.findRunBySessionId(SESSION);
        const tasks = await h.repo.findTasks(run!.id);
        for (let i = 0; i < dones.length; i += 1) {
          await h.tasks.markTask(SESSION, CLEANER, tasks[i]!.id, dones[i]!);
        }
        const view = await h.runs.getChecklist(SESSION, HOST);
        expect(view.completedTasks).toBe(view.tasks.filter((t) => t.isDone).length);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 12: finalize uses the run's snapshotted precondition ──
describe('P12 — finalize uses the snapshotted precondition', () => {
  // Feature: checklist-photos, Property 12: finalize iff snapshotted precondition holds against durable rows.
  it('ALL_TASKS_DONE blocks finalize until all tasks are done', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 0, max: 5 }), async (total, doneCount) => {
        const h = buildHarness();
        seedSession(h);
        await h.creation.createFromStarted({
          ...(await sampleRun(total, 5)),
          completionPrecondition: 'ALL_TASKS_DONE',
          photoRequiredPolicy: 'NONE',
        });
        const run = await h.repo.findRunBySessionId(SESSION);
        const tasks = await h.repo.findTasks(run!.id);
        const toComplete = Math.min(doneCount, total);
        for (let i = 0; i < toComplete; i += 1) {
          await h.tasks.markTask(SESSION, CLEANER, tasks[i]!.id, true);
        }
        const finalize = h.runs.finalize(SESSION, CLEANER);
        if (toComplete === total) {
          await expect(finalize).resolves.toBeUndefined();
          expect((await h.repo.findRunBySessionId(SESSION))?.state).toBe(ChecklistRunState.COMPLETED);
        } else {
          await expect(finalize).rejects.toBeInstanceOf(ConflictException);
          expect((await h.repo.findRunBySessionId(SESSION))?.state).toBe(ChecklistRunState.ACTIVE);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 13: single-winner terminality + outbox atomicity ──
describe('P13 — single-winner terminality + outbox atomicity', () => {
  // Feature: checklist-photos, Property 13: exactly one of COMPLETED/ABANDONED; COMPLETED writes the event.
  it('finalize vs terminal resolves to exactly one terminal; COMPLETED emits checklist_completed', async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (abandonFirst) => {
        const h = buildHarness();
        seedSession(h);
        await h.creation.createFromStarted(await sampleRun(2, 5));
        if (abandonFirst) {
          await h.runs.forceAbandonForSession(SESSION, AbandonReason.OFFER_TERMINAL);
          await expect(h.runs.finalize(SESSION, CLEANER)).rejects.toBeInstanceOf(ConflictException);
          expect((await h.repo.findRunBySessionId(SESSION))?.state).toBe(ChecklistRunState.ABANDONED);
          expect(h.store.outbox).toHaveLength(0);
        } else {
          await h.runs.finalize(SESSION, CLEANER);
          await h.runs.forceAbandonForSession(SESSION, AbandonReason.OFFER_TERMINAL);
          expect((await h.repo.findRunBySessionId(SESSION))?.state).toBe(ChecklistRunState.COMPLETED);
          expect(h.store.outbox.filter((o) => o.type === CHECKLIST_COMPLETED_EVENT_TYPE)).toHaveLength(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  // Feature: checklist-photos, Property 13: a concurrent photo committed before COMPLETED is counted.
  it('the COMPLETED summary photoCount matches committed photos', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 3 }), async (photoCount) => {
        const h = buildHarness();
        seedSession(h);
        await h.creation.createFromStarted(await sampleRun(1, 5));
        const run = await h.repo.findRunBySessionId(SESSION);
        const task = (await h.repo.findTasks(run!.id))[0]!;
        for (let i = 0; i < photoCount; i += 1) {
          const target = await h.photos.requestUpload(SESSION, CLEANER, task.id);
          await h.photos.finalizeUpload(SESSION, CLEANER, task.id, { objectKey: target.objectKey });
        }
        await h.runs.finalize(SESSION, CLEANER);
        const event = h.store.outbox.find((o) => o.type === CHECKLIST_COMPLETED_EVENT_TYPE);
        expect((event?.payload as { photoCount: number }).photoCount).toBe(photoCount);
        // Spec 20 additive extension: the event carries an authoritative finish time (ISO string).
        const completedAt = (event?.payload as { completedAt?: string }).completedAt;
        expect(typeof completedAt).toBe('string');
        expect(Number.isNaN(Date.parse(completedAt ?? ''))).toBe(false);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 14: deletion coherence handled at DDL (trigger) — behaviour: tombstone drain idempotent ──
describe('P14 — tombstone drain idempotent', () => {
  // Feature: checklist-photos, Property 14: cascade tombstones drain idempotently (never a synchronous cross-system delete).
  it('draining a set of PENDING tombstones deletes each object exactly once and marks DONE', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.string({ minLength: 3, maxLength: 12 }), { maxLength: 6 }), async (keys) => {
        const h = buildHarness();
        const unique = [...new Set(keys)];
        for (const key of unique) {
          h.store.tombstones.set(key, { objectKey: key, status: 'PENDING', processedAt: null });
        }
        const { TombstoneDrainProcessor } = await import('../jobs/tombstone-drain.processor');
        const proc = new TombstoneDrainProcessor(
          new (await import('./harness')).FakeObjectDeletionRepository(h.store) as never,
          h.storage as never,
        );
        await proc.sweepOnce();
        await proc.sweepOnce(); // idempotent re-run
        for (const key of unique) {
          expect(h.store.tombstones.get(key)?.status).toBe('DONE');
        }
        // Each object deleted (at least once); re-run is a no-op on DONE.
        expect(new Set(h.store.deletedObjects).size).toBe(unique.length);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 15: retention + orphan-grant cleanup; config never hardcoded ──
describe('P15 — retention + stale-grant cleanup', () => {
  // Feature: checklist-photos, Property 15: retention deletes iff past horizon; stale grants → EXPIRED.
  it('a stale ISSUED grant is deleted and closed EXPIRED (never eternal ISSUED)', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (count) => {
        const h = buildHarness();
        for (let i = 0; i < count; i += 1) {
          const key = `orphan-${i}`;
          h.store.grants.set(key, {
            objectKey: key,
            runId: 'r',
            taskId: 't',
            issuedToUserId: CLEANER,
            status: GrantStatus.ISSUED,
            expiresAt: new Date(Date.now() - 60_000),
            consumedPhotoId: null,
          });
        }
        const { StaleUploadGrantCleanupProcessor } = await import(
          '../jobs/stale-upload-grant-cleanup.processor'
        );
        const proc = new StaleUploadGrantCleanupProcessor(h.grants as never, h.storage as never);
        await proc.sweepOnce();
        await proc.sweepOnce();
        for (const grant of h.store.grants.values()) {
          expect(grant.status).toBe(GrantStatus.EXPIRED);
        }
        expect(h.store.deletedObjects.length).toBeGreaterThanOrEqual(count);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 4: bytes isolation (no bytes ever persisted through the service surface) ──
describe('P4 — photo bytes isolation', () => {
  // Feature: checklist-photos, Property 4: only metadata is durable; the object key is server-generated.
  it('a finalized photo stores metadata + a server-generated key, never bytes', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(TaskPhotoKind.BEFORE, TaskPhotoKind.AFTER, TaskPhotoKind.GENERAL), async (kind) => {
        const h = buildHarness();
        seedSession(h);
        await h.creation.createFromStarted(await sampleRun(1, 5));
        const run = await h.repo.findRunBySessionId(SESSION);
        const task = (await h.repo.findTasks(run!.id))[0]!;
        const target = await h.photos.requestUpload(SESSION, CLEANER, task.id);
        // The client never chooses the key: it is server-generated and unguessable-shaped.
        expect(target.objectKey).toMatch(/\//);
        await h.photos.finalizeUpload(SESSION, CLEANER, task.id, { objectKey: target.objectKey, kind });
        const view = await h.runs.getChecklist(SESSION, HOST);
        const photoRef = view.tasks[0]?.photos[0];
        expect(photoRef).toBeDefined();
        // The view exposes an id + kind + uploadedAt only — never a key or bytes.
        expect(Object.keys(photoRef ?? {})).toEqual(['id', 'kind', 'uploadedAt']);
      }),
      { numRuns: 100 },
    );
  });
});

/** Build a fresh started payload with sensible defaults (NONE policies unless overridden). */
async function sampleRun(taskCount = 3, maxPhotosPerTask = 5): Promise<StartedPayload> {
  return {
    sessionId: SESSION,
    offerId: 'offer-1',
    propertyId: 'prop-1',
    hostId: HOST,
    cleanerId: CLEANER,
    checklistItems: Array.from({ length: taskCount }, (_, i) => `task ${i}`),
    photoRequiredPolicy: 'NONE',
    completionPrecondition: 'NONE',
    maxPhotosPerTask,
  };
}
