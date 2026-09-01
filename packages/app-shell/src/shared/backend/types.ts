import type { BackendPorts, BackendPortsContext } from '@we/backend-shared';

/**
 * Raw connection details for the running executor, for callers that need to reach it directly
 * rather than through the client — currently the embedded-app handshake, which forwards them into
 * an iframe so a hosted app can attach to the same agent.
 */
export interface BackendConnectionDetails {
  port: number;
  token: string;
  url?: string;
}

/**
 * The node this session is running against, when it is somebody's hosting rather than this machine.
 *
 * Absent on the desktop hosts, which start their own executor — there is no "connected to" to
 * report, and the answer would be "your own computer".
 *
 * Neutral by intent, though it is currently only AD4M that fills it in: a hosted backend of any
 * shape has a name, an address, and possibly a bill. What is deliberately *not* here is anything
 * about how to talk to the node — that is {@link BackendConnectionDetails}. This is what to tell the
 * user about where their data is.
 */
export interface BackendHostInfo {
  /** Stable id from whatever directory the host was chosen out of. */
  id: string;
  name: string;
  description?: string;
  /** Host's own image, for the settings row. */
  imageUrl?: string;
  /** Human-readable, e.g. a region or city — not coordinates. */
  location?: string;
  url: string;
  /** Hardware the operator advertises, displayed verbatim. */
  computeSpecs?: string;
  /**
   * AI models the host advertises it can run.
   *
   * Worth carrying separately from `RuntimeAdminPort.aiModels`: this comes from the host directory
   * and is readable without any capability at all, so it can answer "can this node transcribe?" even
   * where the executor would refuse to list its models.
   */
  aiModels?: string[];
  /** What the operator charges, as they describe it. Empty when the host is free. */
  rates?: { description: string; priceInHOT: number }[];
}

/**
 * This agent's account with the host — who they are to it, and what they have left to spend.
 *
 * Separate from {@link BackendHostInfo} because it changes while the app runs and the host does not.
 * Running out of credits mid-call, in an app that never mentioned credits existed, is the failure
 * this exists to prevent.
 */
export interface BackendAccountInfo {
  email?: string;
  remainingCredits?: number;
  walletAddress?: string;
  /** True when the operator is not charging this agent, so the credit figure means nothing. */
  freeAccess?: boolean;
  /**
   * URL to manage billing (Stripe portal, Unyt dashboard, or any external billing surface).
   *
   * When present, the settings page offers a "Manage billing" link. Absent for self-hosted nodes
   * that have no billing provider — the field existing on the type is not the same as the user
   * having a bill to pay.
   */
  billingPortalUrl?: string;
}

/**
 * How a host obtains a data-layer client.
 *
 * Split out of {@link PlatformAdapter}, which had grown to answer two unrelated questions: *where am
 * I running* (web / electron / tauri, dev or not, how to resolve an embedded app's URL) and *how do
 * I reach the data layer*. Those vary independently — the same web host reaches the executor through
 * a different mechanism than electron does, while resolving app URLs identically to neither — so
 * fusing them meant every host implemented one interface for two reasons and the platform contract
 * named a client type it has no business knowing about.
 *
 * The practical symptom: `platform/types.ts` imported `@coasys/ad4m` purely for a return type, so
 * every host that wanted `isDesktop` also named the data layer.
 */
/** Everything `initialize()` hands the shell — the connected client, the port bundle over it,
 * and (when the backend has something to forward) the raw connection details the embed bridge
 * relays to hosted apps. */
export interface BackendInitResult {
  client: unknown;
  ports: BackendPorts;
  connection?: BackendConnectionDetails;
  /** The node this session runs against, when it is not this machine. See {@link BackendHostInfo}. */
  host?: BackendHostInfo;
  /** This agent's account with that node, when it keeps one. See {@link BackendAccountInfo}. */
  account?: BackendAccountInfo;
  /**
   * This session's identity was minted by the connector itself, for somebody who arrived without
   * one — a guest, in the sense the invite link means.
   *
   * Distinct from `host` being present, which only says the node belongs to somebody else: an
   * ordinary member of a hosted deployment has a host and is not a guest. What this answers is
   * "did this person choose this identity, or did a link create one for them" — which changes what
   * the app should say to them, starting with why it is asking for a name.
   */
  guest?: boolean;
  /**
   * End this app's connection to the backend, for backends where the session *is* the connection.
   *
   * Supplied by the connector rather than sitting on a port, because it is the connector that knows
   * how the connection was obtained and holds whatever has to be forgotten — a stored token, a
   * chosen host. The ports only ever see a connected client.
   *
   * Optional, and absent on the desktop hosts: they start the executor themselves, so ending a
   * session there means locking the agent or restarting the backend, both of which the shell can
   * already reach. It matters on web, where the agent may live on someone else's node and was never
   * unlocked with a password this app holds — leaving "log out" with nothing to do but show a
   * sign-in form for a lock that is not there.
   */
  disconnect?: () => Promise<void>;
}

export interface BackendConnector {
  /**
   * Perform this backend's entire connection choreography — spawn/attach, auth, credential
   * acquisition, any settling delays — and return the ready-to-use result. Called once during
   * boot. The shell holds no opinions about how a backend comes up; ordering quirks (an executor
   * that needs a moment to start, credentials that only exist after an auth UI) live with the
   * connector that owns them.
   */
  initialize(ctx: BackendPortsContext): Promise<BackendInitResult>;
}
