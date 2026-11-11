/**
 * The `call` kernel — a call run by the backend, rather than by the module's own peer-to-peer mesh.
 *
 * It replaces four fields the deps bag carried for the call module alone (`createBackend`,
 * `getCallConfig`, `setCallConfig`, `callConfigSupported`), handed to every module whether it asked
 * or not and typed `unknown`. Declared, a module names it in its manifest and receives it under
 * `deps.kernels.call`, and an install screen can say that it reaches the backend's calls.
 *
 * ## Present is not the same as able
 *
 * The host implements the kernel whatever backend is connected, so registration never refuses the
 * call module over it. `available()` is what says the backend behind it can run a call; where it
 * answers no, the call module runs its own mesh instead.
 *
 * ## The session is structural
 *
 * A backend's session satisfies {@link CallSession} without importing it — AD4M's `Session` does —
 * so the module never touches a backend type and the backend never depends on a module.
 */

/** Quality layer the backend can forward (SFU simulcast). */
export type CallQuality = 'high' | 'medium' | 'low';

/**
 * A remote participant as reported by the session.
 *
 * A participant is one session, not one agent. An agent in the call from two devices is two
 * participants with the same `agentDid` and different `participantId`s, and this agent's own other
 * devices are listed too. On a mesh the two ids are the same.
 */
export interface CallParticipant {
  /** The session in the call. Unique among the participants; on a mesh, the DID. */
  participantId: string;
  agentDid: string;
  stream: MediaStream;
  hasAudio: boolean;
  hasVideo: boolean;
  isActiveSpeaker: boolean;
}

/** A data channel message from another participant, relayed through the session. */
export interface CallDataMessage {
  senderDid: string;
  channelLabel: string;
  data: string;
  binary: boolean;
}

/** One call's session on the backend — topology-agnostic. */
export interface CallSession {
  join(localStream: MediaStream): Promise<void>;
  leave(): Promise<void>;
  destroy(): Promise<void>;
  replaceTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null): Promise<void>;
  setQualityPreference(pref: CallQuality): Promise<void>;
  readonly participants: ReadonlyArray<CallParticipant>;
  getState(): string;
  /**
   * Session events. `replaced` says this device joined the call again from another tab: this
   * session's call has ended, it is idle, and it does not rejoin by itself.
   */
  on(event: string, cb: (...args: unknown[]) => void): void;
  off(event: string, cb?: (...args: unknown[]) => void): void;
  /** Send data to all other participants via the session's relay (SFU or mesh signalling). */
  sendData(label: string, data: string, binary?: boolean): Promise<void>;
  /** Subscribe to data channel messages. Returns an unsubscribe function. */
  onData(cb: (message: CallDataMessage) => void): () => void;
  /** Rebuild one peer's connection, telling the peer to do the same. Mesh sessions only. */
  reconnect?(peerId: string): void;
  /** How a peer's media travels — `host`, `srflx` or `relay` — or `null`. Mesh sessions only. */
  transportOf?(peerId: string): Promise<string | null>;
}

/** What a session is asked for beyond its call id. */
export interface CallSessionRequest {
  /** The ICE servers to use. */
  iceServers?: RTCIceServer[];
  /** The topology a running call is on, which wins over the space's policy. */
  topology?: 'mesh' | 'sfu';
  /**
   * The shared uri of the space the call is in, which is not always the space on screen — somebody
   * following a switch from another space reconnects into the call's own. Absent, the space on screen.
   */
  datasetUri?: string;
}

export interface CallKernel {
  /** Whether the connected backend can run a call. Where it cannot, run the module's own mesh. */
  available: () => boolean;
  /** Build the backend's session for one call. Rejects where the call's space is not joined. */
  session: (callId: string, request?: CallSessionRequest) => Promise<CallSession>;
  /**
   * The space on screen's call policy — its creator's topology decisions — for the module to parse.
   * Rejects where there is none to read; fall back to mesh.
   */
  config: () => Promise<unknown>;
  /** Store the space on screen's call policy. Resolves false when the backend refuses the write. */
  setConfig: (config: unknown) => Promise<boolean>;
  /** Whether the space on screen has a call policy to configure — not in a personal space. */
  configurable: () => boolean;
}
