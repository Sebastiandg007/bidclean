import { UploadGrantRepository } from '../../voice/upload-grant.repository';
import { VoiceNoteRepository } from '../../voice/voice-note.repository';
import { VoiceNoteStorageService } from '../../voice/voice-note-storage.service';
import { VoiceTranscriptionEnqueuer } from '../../chat.service';

/**
 * Voice-note collaborators as jest mocks, so tests exercising only TEXT can construct `ChatService`
 * without a live MinIO / grants / transcription queue. Tests that exercise voice override the
 * relevant methods per case.
 */
export interface VoiceDoubles {
  readonly grantRepository: jest.Mocked<
    Pick<
      UploadGrantRepository,
      'createGrant' | 'findConsumable' | 'markConsumed' | 'findExpiredIssued' | 'deleteGrant' | 'existsForObject'
    >
  >;
  readonly voiceNoteRepository: jest.Mocked<
    Pick<
      VoiceNoteRepository,
      | 'insertVoiceNote'
      | 'findByMessageId'
      | 'claimTranscriptAttempt'
      | 'attachTranscript'
      | 'findStuckPending'
      | 'existsForObject'
      | 'markFailed'
    >
  >;
  readonly voiceStorage: jest.Mocked<
    Pick<
      VoiceNoteStorageService,
      | 'generateObjectKey'
      | 'presignUploadTarget'
      | 'issueUploadTarget'
      | 'getPlaybackTarget'
      | 'getObject'
      | 'inspectObject'
      | 'deleteObjectSafe'
      | 'listObjectsOlderThan'
    >
  >;
  readonly transcriptionQueue: jest.Mocked<VoiceTranscriptionEnqueuer>;
}

/** Build a fresh set of voice-note collaborator doubles for a test. */
export function makeVoiceDoubles(): VoiceDoubles {
  return {
    grantRepository: {
      createGrant: jest.fn(),
      findConsumable: jest.fn(),
      markConsumed: jest.fn(),
      findExpiredIssued: jest.fn(),
      deleteGrant: jest.fn(),
      existsForObject: jest.fn(),
    },
    voiceNoteRepository: {
      insertVoiceNote: jest.fn(),
      findByMessageId: jest.fn().mockResolvedValue(null),
      claimTranscriptAttempt: jest.fn(),
      attachTranscript: jest.fn(),
      findStuckPending: jest.fn(),
      existsForObject: jest.fn(),
      markFailed: jest.fn(),
    },
    voiceStorage: {
      generateObjectKey: jest.fn(),
      presignUploadTarget: jest.fn(),
      issueUploadTarget: jest.fn(),
      getPlaybackTarget: jest.fn(),
      getObject: jest.fn(),
      inspectObject: jest.fn(),
      deleteObjectSafe: jest.fn(),
      listObjectsOlderThan: jest.fn(),
    },
    transcriptionQueue: { add: jest.fn().mockResolvedValue(undefined) },
  };
}