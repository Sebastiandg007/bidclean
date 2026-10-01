/**
 * Minimal ambient declarations for the LiveKit React Native SDK surface used by voip-calls.
 *
 * The full `@livekit/react-native` / `@livekit/react-native-webrtc` packages are native modules
 * (they require a prebuild / EAS build and cannot run under Expo Go or in Jest). Unit tests mock
 * them (`src/__mocks__/setup.ts`) and the production build resolves the real packages. These
 * declarations describe ONLY the small API the `useLiveKitRoom` hook depends on, so `tsc` type-
 * checks against a stable contract without pulling the native types into the test toolchain.
 */

declare module '@livekit/react-native' {
  /** A remote/local media track. */
  export class Track {
    static Source: {
      Camera: 'camera';
      Microphone: 'microphone';
      ScreenShare: 'screen_share';
    };
  }

  /** The connection lifecycle states we observe. */
  export enum ConnectionState {
    Disconnected = 'disconnected',
    Connecting = 'connecting',
    Connected = 'connected',
    Reconnecting = 'reconnecting',
  }

  /** The room events we subscribe to. */
  export enum RoomEvent {
    Connected = 'connected',
    Disconnected = 'disconnected',
    Reconnecting = 'reconnecting',
    Reconnected = 'reconnected',
    ParticipantConnected = 'participantConnected',
    ParticipantDisconnected = 'participantDisconnected',
    TrackSubscribed = 'trackSubscribed',
    TrackUnsubscribed = 'trackUnsubscribed',
    ConnectionStateChanged = 'connectionStateChanged',
  }

  /** The local participant: publish controls for mic/camera. */
  export interface LocalParticipant {
    setMicrophoneEnabled(enabled: boolean): Promise<void>;
    setCameraEnabled(enabled: boolean): Promise<void>;
    readonly isMicrophoneEnabled: boolean;
    readonly isCameraEnabled: boolean;
  }

  export interface RoomConnectOptions {
    autoSubscribe?: boolean;
  }

  export interface RoomOptions {
    adaptiveStream?: boolean;
    dynacast?: boolean;
  }

  /** A LiveKit room; the media session for one call. */
  export class Room {
    constructor(options?: RoomOptions);
    readonly localParticipant: LocalParticipant;
    readonly state: ConnectionState;
    connect(url: string, token: string, options?: RoomConnectOptions): Promise<void>;
    disconnect(): Promise<void>;
    on(event: RoomEvent | string, listener: (...args: unknown[]) => void): this;
    off(event: RoomEvent | string, listener: (...args: unknown[]) => void): this;
    removeAllListeners(event?: RoomEvent | string): this;
  }

  /** Registers the WebRTC globals; called once at app start (no-op in tests). */
  export function registerGlobals(): void;

  /** Sets up the LiveKit audio session (Android/iOS). */
  export class AudioSession {
    static startAudioSession(): Promise<void>;
    static stopAudioSession(): Promise<void>;
    static configureAudio(config: unknown): Promise<void>;
  }
}

declare module '@livekit/react-native-webrtc' {
  /** Placeholder — the webrtc layer is initialized transitively by `registerGlobals`. */
  export const mediaDevices: unknown;
}
