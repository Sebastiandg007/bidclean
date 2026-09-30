import { EntityManager } from 'typeorm';

import { ChecklistParticipationService } from '../service/checklist-participation.service';
import { ChecklistPhotoService } from '../service/checklist-photo.service';
import { ChecklistRunCreationService } from '../service/checklist-run-creation.service';
import { ChecklistRunService } from '../service/checklist-run.service';
import { ChecklistStorageService } from '../storage/checklist-storage.service';
import { ChecklistTaskService } from '../service/checklist-task.service';
import { ChecklistRepository, InsertPhotoParams, RunRow, TaskRow } from '../repository/checklist.repository';
import {
  ChecklistUploadGrantRepository,
  ConsumableGrant,
  CreateGrantParams,
} from '../repository/checklist-upload-grant.repository';
import { OutboxRow } from '../../common/outbox/outbox-writer';
import {
  ChecklistRunState,
  GrantStatus,
  InspectResult,
  StartedPayload,
} from '../checklist.types';

/**
 * In-memory test harness modelling the checklist-photos DB invariants (mirrors the service-tracking
 * scenarios FakeRepo). It lets the real services run against deterministic state so property-based
 * tests can quantify over behaviour. `withTransaction` runs the callback synchronously (one logical
 * transaction); `lockRun` is a no-op lock in this single-threaded model, and concurrency is
 * simulated by serializing operations (the production lock enforces the same serialization).
 */

/** A stored run (mutable). */
interface StoredRun {
  id: string;
  serviceSessionId: string;
  offerId: string;
  propertyId: string | null;
  totalTasks: number;
  completedTasks: number;
  photoRequiredPolicy: unknown;
  completionPrecondition: unknown;
  maxPhotosPerTask: number;
  state: string;
  abandonedReason: string | null;
  updatedAt: number;
}

/** A stored task (mutable). */
interface StoredTask {
  id: string;
  runId: string;
  position: number;
  taskText: string;
  isDone: boolean;
  completedAt: Date | null;
}

/** A stored photo (metadata only). */
interface StoredPhoto {
  id: string;
  taskId: string;
  runId: string;
  objectKey: string;
  kind: string;
  uploadedAt: Date;
  objectDeletedAt: Date | null;
}

/** A stored grant (mutable). */
interface StoredGrant {
  objectKey: string;
  runId: string;
  taskId: string;
  issuedToUserId: string | null;
  status: string;
  expiresAt: Date;
  consumedPhotoId: string | null;
}

/** A stored tombstone. */
interface StoredTombstone {
  objectKey: string;
  status: string;
  processedAt: Date | null;
}

/** A session participant record. */
export interface FakeSession {
  hostId: string | null;
  cleanerId: string | null;
  state: string;
}

let idSeq = 0;
function nextId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${idSeq}`;
}

/** The shared in-memory store all fakes read/write. */
export class FakeStore {
  runs = new Map<string, StoredRun>();
  runBySession = new Map<string, string>();
  tasks = new Map<string, StoredTask>();
  photos = new Map<string, StoredPhoto>();
  grants = new Map<string, StoredGrant>();
  tombstones = new Map<string, StoredTombstone>();
  sessions = new Map<string, FakeSession>();
  outbox: OutboxRow[] = [];
  deletedObjects: string[] = [];

  now(): number {
    return Date.now();
  }

  setSession(sessionId: string, session: FakeSession): void {
    this.sessions.set(sessionId, session);
  }
}

/** A fake EntityManager marker; the harness ignores it (single logical tx). */
const FAKE_MANAGER = {} as EntityManager;

/** The fake ChecklistRepository over the shared store. */
export class FakeChecklistRepository {
  constructor(private readonly store: FakeStore) {}

  async createRunWithTasks(payload: StartedPayload): Promise<boolean> {
    if (this.store.runBySession.has(payload.sessionId)) {
      return false;
    }
    const id = nextId('run');
    this.store.runs.set(id, {
      id,
      serviceSessionId: payload.sessionId,
      offerId: payload.offerId,
      propertyId: payload.propertyId,
      totalTasks: payload.checklistItems.length,
      completedTasks: 0,
      photoRequiredPolicy: payload.photoRequiredPolicy,
      completionPrecondition: payload.completionPrecondition,
      maxPhotosPerTask: payload.maxPhotosPerTask,
      state: ChecklistRunState.ACTIVE,
      abandonedReason: null,
      updatedAt: this.store.now(),
    });
    this.store.runBySession.set(payload.sessionId, id);
    payload.checklistItems.forEach((text, index) => {
      const taskId = nextId('task');
      this.store.tasks.set(taskId, {
        id: taskId,
        runId: id,
        position: index,
        taskText: text,
        isDone: false,
        completedAt: null,
      });
    });
    return true;
  }

  private toRunRow(run: StoredRun): RunRow {
    return {
      id: run.id,
      service_session_id: run.serviceSessionId,
      offer_id: run.offerId,
      property_id: run.propertyId,
      total_tasks: run.totalTasks,
      completed_tasks: run.completedTasks,
      photo_required_policy_snapshot: run.photoRequiredPolicy,
      completion_precondition_snapshot: run.completionPrecondition,
      max_photos_per_task_snapshot: run.maxPhotosPerTask,
      state: run.state,
      completed_at: null,
      abandoned_reason: run.abandonedReason,
    };
  }

  private toTaskRow(task: StoredTask): TaskRow {
    return {
      id: task.id,
      run_id: task.runId,
      position: task.position,
      task_text: task.taskText,
      is_done: task.isDone,
      completed_at: task.completedAt,
    };
  }

  async findRunBySessionId(sessionId: string): Promise<RunRow | null> {
    const id = this.store.runBySession.get(sessionId);
    const run = id ? this.store.runs.get(id) : undefined;
    return run ? this.toRunRow(run) : null;
  }

  async findRunByOfferId(offerId: string): Promise<RunRow | null> {
    for (const run of this.store.runs.values()) {
      if (run.offerId === offerId) {
        return this.toRunRow(run);
      }
    }
    return null;
  }

  async findTaskById(taskId: string): Promise<TaskRow | null> {
    const task = this.store.tasks.get(taskId);
    return task ? this.toTaskRow(task) : null;
  }

  async findTasks(runId: string): Promise<TaskRow[]> {
    return [...this.store.tasks.values()]
      .filter((task) => task.runId === runId)
      .sort((a, b) => a.position - b.position)
      .map((task) => this.toTaskRow(task));
  }

  async findPhotosForRun(runId: string): Promise<
    Array<{
      id: string;
      task_id: string;
      run_id: string;
      object_key: string;
      kind: string;
      uploaded_at: Date;
      object_deleted_at: Date | null;
    }>
  > {
    return [...this.store.photos.values()]
      .filter((photo) => photo.runId === runId)
      .map((photo) => ({
        id: photo.id,
        task_id: photo.taskId,
        run_id: photo.runId,
        object_key: photo.objectKey,
        kind: photo.kind,
        uploaded_at: photo.uploadedAt,
        object_deleted_at: photo.objectDeletedAt,
      }));
  }

  async findPhotoScopedToSession(
    photoId: string,
    sessionId: string,
  ): Promise<{ objectKey: string; objectDeletedAt: Date | null } | null> {
    const photo = this.store.photos.get(photoId);
    if (!photo) {
      return null;
    }
    const run = this.store.runs.get(photo.runId);
    if (!run || run.serviceSessionId !== sessionId) {
      return null;
    }
    return { objectKey: photo.objectKey, objectDeletedAt: photo.objectDeletedAt };
  }

  async countPhotosForTask(_manager: EntityManager, taskId: string): Promise<number> {
    void _manager;
    return [...this.store.photos.values()].filter((photo) => photo.taskId === taskId).length;
  }

  async countPhotosForRun(_manager: EntityManager, runId: string): Promise<number> {
    void _manager;
    return [...this.store.photos.values()].filter((photo) => photo.runId === runId).length;
  }

  async lockRun(_manager: EntityManager, runId: string): Promise<RunRow | null> {
    void _manager;
    const run = this.store.runs.get(runId);
    return run ? this.toRunRow(run) : null;
  }

  async markTaskAtomic(
    _manager: EntityManager,
    runId: string,
    taskId: string,
    done: boolean,
  ): Promise<void> {
    void _manager;
    const task = this.store.tasks.get(taskId);
    if (task && task.runId === runId) {
      task.isDone = done;
      task.completedAt = done ? (task.completedAt ?? new Date()) : null;
    }
    const run = this.store.runs.get(runId);
    if (run) {
      run.completedTasks = [...this.store.tasks.values()].filter(
        (candidate) => candidate.runId === runId && candidate.isDone,
      ).length;
      run.updatedAt = this.store.now();
    }
  }

  async insertPhoto(_manager: EntityManager, params: InsertPhotoParams): Promise<string> {
    void _manager;
    const id = nextId('photo');
    this.store.photos.set(id, {
      id,
      taskId: params.taskId,
      runId: params.runId,
      objectKey: params.objectKey,
      kind: params.kind,
      uploadedAt: new Date(),
      objectDeletedAt: null,
    });
    return id;
  }

  async transitionRun(
    _manager: EntityManager,
    runId: string,
    next: ChecklistRunState,
    derived: { completedAt?: boolean; abandonedReason?: string },
    outbox: OutboxRow | null,
  ): Promise<boolean> {
    void _manager;
    const run = this.store.runs.get(runId);
    if (!run || run.state !== ChecklistRunState.ACTIVE) {
      return false;
    }
    run.state = next;
    if (derived.abandonedReason) {
      run.abandonedReason = derived.abandonedReason;
    }
    run.updatedAt = this.store.now();
    if (outbox) {
      if (!this.store.outbox.some((row) => row.eventId === outbox.eventId)) {
        this.store.outbox.push(outbox);
      }
    }
    return true;
  }

  async withTransaction<T>(fn: (manager: EntityManager) => Promise<T>): Promise<T> {
    return fn(FAKE_MANAGER);
  }

  async findRetentionEligible(
    before: Date,
    limit: number,
  ): Promise<Array<{ id: string; objectKey: string }>> {
    return [...this.store.photos.values()]
      .filter((photo) => photo.objectDeletedAt === null && photo.uploadedAt < before)
      .sort((a, b) => a.uploadedAt.getTime() - b.uploadedAt.getTime())
      .slice(0, limit)
      .map((photo) => ({ id: photo.id, objectKey: photo.objectKey }));
  }

  async markObjectDeleted(photoId: string): Promise<void> {
    const photo = this.store.photos.get(photoId);
    if (photo && photo.objectDeletedAt === null) {
      photo.objectDeletedAt = new Date();
    }
  }

  async findStaleActiveRuns(before: Date, limit: number): Promise<string[]> {
    return [...this.store.runs.values()]
      .filter((run) => {
        if (run.state !== ChecklistRunState.ACTIVE) {
          return false;
        }
        const session = this.store.sessions.get(run.serviceSessionId);
        const terminal = session?.state === 'CANCELED' || session?.state === 'EXPIRED';
        return terminal && run.updatedAt < before.getTime();
      })
      .slice(0, limit)
      .map((run) => run.id);
  }

  async findSessionParticipants(
    sessionId: string,
  ): Promise<{ hostId: string | null; cleanerId: string | null; state: string } | null> {
    const session = this.store.sessions.get(sessionId);
    if (!session) {
      return null;
    }
    return { hostId: session.hostId, cleanerId: session.cleanerId, state: session.state };
  }

  async resolveChecklistItems(_propertyId: string): Promise<string[] | null> {
    void _propertyId;
    return null;
  }
}

/** The fake grant repository over the shared store. */
export class FakeGrantRepository {
  constructor(private readonly store: FakeStore) {}

  async createGrant(_manager: EntityManager, params: CreateGrantParams): Promise<void> {
    void _manager;
    this.store.grants.set(params.objectKey, {
      objectKey: params.objectKey,
      runId: params.runId,
      taskId: params.taskId,
      issuedToUserId: params.issuedToUserId,
      status: GrantStatus.ISSUED,
      expiresAt: new Date(this.store.now() + 600_000),
      consumedPhotoId: null,
    });
  }

  async countActiveGrantsForTask(
    _manager: EntityManager,
    taskId: string,
    now: Date,
  ): Promise<number> {
    void _manager;
    return [...this.store.grants.values()].filter(
      (grant) =>
        grant.taskId === taskId && grant.status === GrantStatus.ISSUED && grant.expiresAt > now,
    ).length;
  }

  async findConsumable(_manager: EntityManager, objectKey: string): Promise<ConsumableGrant | null> {
    void _manager;
    const grant = this.store.grants.get(objectKey);
    if (!grant) {
      return null;
    }
    return {
      objectKey: grant.objectKey,
      runId: grant.runId,
      taskId: grant.taskId,
      issuedToUserId: grant.issuedToUserId,
      status: grant.status,
      expiresAt: grant.expiresAt,
    };
  }

  async markConsumed(_manager: EntityManager, objectKey: string, photoId: string): Promise<void> {
    void _manager;
    const grant = this.store.grants.get(objectKey);
    if (grant) {
      grant.status = GrantStatus.CONSUMED;
      grant.consumedPhotoId = photoId;
    }
  }

  async findStaleGrants(now: Date, limit: number): Promise<Array<{ objectKey: string }>> {
    return [...this.store.grants.values()]
      .filter((grant) => grant.status === GrantStatus.ISSUED && grant.expiresAt < now)
      .slice(0, limit)
      .map((grant) => ({ objectKey: grant.objectKey }));
  }

  async markClosed(objectKey: string, status: GrantStatus): Promise<void> {
    const grant = this.store.grants.get(objectKey);
    if (grant && grant.status === GrantStatus.ISSUED) {
      grant.status = status;
    }
  }
}

/** The fake object-deletion repository over the shared store. */
export class FakeObjectDeletionRepository {
  constructor(private readonly store: FakeStore) {}

  async drainPending(limit: number): Promise<Array<{ objectKey: string }>> {
    return [...this.store.tombstones.values()]
      .filter((tombstone) => tombstone.status === 'PENDING')
      .slice(0, limit)
      .map((tombstone) => ({ objectKey: tombstone.objectKey }));
  }

  async markDone(objectKey: string): Promise<void> {
    const tombstone = this.store.tombstones.get(objectKey);
    if (tombstone) {
      tombstone.status = 'DONE';
      tombstone.processedAt = new Date();
    }
  }
}

/** The fake storage service: server-authoritative inspection is injected per object key. */
export class FakeStorage {
  constructor(private readonly store: FakeStore) {}
  private keySeq = 0;
  inspections = new Map<string, InspectResult>();

  generateObjectKey(): string {
    this.keySeq += 1;
    return `ab/${this.keySeq}-${nextId('key')}`;
  }

  async presignUploadTarget(objectKey: string): Promise<{ objectKey: string; uploadUrl: string; expiresAt: string }> {
    return { objectKey, uploadUrl: `https://minio.local/put/${objectKey}`, expiresAt: new Date().toISOString() };
  }

  async getPlaybackTarget(objectKey: string): Promise<{ playbackUrl: string; expiresAt: string }> {
    return { playbackUrl: `https://minio.local/get/${objectKey}`, expiresAt: new Date().toISOString() };
  }

  async inspectObject(objectKey: string): Promise<InspectResult> {
    return (
      this.inspections.get(objectKey) ?? {
        exists: true,
        sizeBytes: 1024,
        contentType: 'image/jpeg',
        width: 100,
        height: 100,
      }
    );
  }

  async deleteObjectSafe(objectKey: string): Promise<void> {
    // Idempotent object removal — record it; the tombstone row lifecycle is owned by markDone.
    this.store.deletedObjects.push(objectKey);
  }
}

/** A fully wired set of services over one shared store, for behavioural (property) testing. */
export interface Harness {
  store: FakeStore;
  storage: FakeStorage;
  repo: FakeChecklistRepository;
  grants: FakeGrantRepository;
  creation: ChecklistRunCreationService;
  tasks: ChecklistTaskService;
  photos: ChecklistPhotoService;
  runs: ChecklistRunService;
  participation: ChecklistParticipationService;
}

/** Build a fresh harness (fresh store + wired real services). */
export function buildHarness(): Harness {
  const store = new FakeStore();
  const repo = new FakeChecklistRepository(store) as unknown as ChecklistRepository;
  const grants = new FakeGrantRepository(store) as unknown as ChecklistUploadGrantRepository;
  const storage = new FakeStorage(store) as unknown as ChecklistStorageService;
  const participation = new ChecklistParticipationService(repo);
  const creation = new ChecklistRunCreationService(repo);
  const tasks = new ChecklistTaskService(repo, participation);
  const photos = new ChecklistPhotoService(repo, grants, storage, participation);
  const runs = new ChecklistRunService(repo, participation);
  return {
    store,
    storage: storage as unknown as FakeStorage,
    repo: repo as unknown as FakeChecklistRepository,
    grants: grants as unknown as FakeGrantRepository,
    creation,
    tasks,
    photos,
    runs,
    participation,
  };
}
