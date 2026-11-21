/**
 * Bots: agents with keys of their own that act for a person, within a grant the person controls.
 *
 * ## Two ceilings, and who sets each
 *
 * A bot's **key** joins the person's key log with a bot mark and a scope — the actions it may ever
 * take and until when. That is an identity change, signed by the master key, so it runs where the
 * master key is kept (`IdentityPort.change({ kind: 'add-bot' })`), never through this port.
 *
 * Its **grant** is what it may do now: the spaces, the actions (inside the key's scope), an end, and
 * whether it is active, paused or revoked. The grant is held by the backend that runs the bot and is
 * changed here, by whoever that backend lets act for the person.
 *
 * ## Why every grant change carries a version
 *
 * Two windows, or a person and an automation, can edit one grant. A grant is replaced whole, so a
 * save that does not say which version it replaces would silently undo the other edit. A stale save
 * is refused as a {@link BotGrantConflict}; the caller reads the grant again and shows it.
 *
 * ## The credential
 *
 * `create` answers the bot's session credential once. It is for the program that runs the bot, so
 * this port returns it and keeps nothing: a caller shows it once and lets it go.
 */

/** What a bot may do in a space. */
export type BotAction = 'read' | 'write' | 'join';

export const BOT_ACTIONS: readonly BotAction[] = ['read', 'write', 'join'];

/** Whether a grant is in force. `revoked` is for good. */
export type BotGrantState = 'active' | 'paused' | 'revoked';

/** What the person's key log says about the bot's key. */
export type BotKeyVerdict = 'valid' | 'revoked' | 'expired' | 'not-in-log';

export interface BotGrantView {
  /** The spaces the bot may act in, as the backend names them. */
  spaces: string[];
  can: BotAction[];
  /** Unix seconds; `null` for no end but the key's. */
  expires: number | null;
  state: BotGrantState;
  /** The version a change must name to replace this grant. */
  version: number;
  updatedAt: number;
}

/** The bot's key, as the person's key log says: the ceiling of every grant. */
export interface BotKeyView {
  /** Its id in the key log (`d3`). */
  keyId: string;
  verdict: BotKeyVerdict;
  /** The actions the key may ever take. */
  can: BotAction[];
  /** When the key ends, unix seconds; `null` for none. */
  expires: number | null;
}

export interface BotView {
  /** The bot's own agent. */
  did: string;
  name: string;
  /** The identity it acts for. */
  owner: string;
  /** Unix seconds. */
  createdAt: number;
  grant: BotGrantView;
  /** `null` until the person confirms the bot's key where the master key is kept. */
  key: BotKeyView | null;
}

/** A bot just made: what both sides show to match, and its credential, answered once. */
export interface CreatedBotView {
  did: string;
  /** The identity it acts for. */
  owner: string;
  /** The code the person checks where the master key is kept. */
  matchCode: string;
  /** When the offer the bot claimed ends, unix seconds: confirm before then. */
  expires: number;
  /** The bot's session credential. Shown once; never kept or logged. */
  token: string;
}

/** A grant as a change sends it: the whole grant, and the version it replaces. */
export interface BotGrantInput {
  spaces: string[];
  can: BotAction[];
  expires: number | null;
  state: BotGrantState;
  version: number;
}

/** One entry of a bot's activity log. */
export interface BotActivityView {
  /** Its place in the log: `before` pages from it. */
  id: number;
  /** Unix seconds. */
  at: number;
  /** The call the bot made. */
  method: string;
  /** `null` for a call outside every action. */
  action: BotAction | null;
  space: string | null;
  /** The reason the bot gave. */
  reason: string | null;
  allowed: boolean;
  /** Why it was refused (`bot-grant`, `bot-paused`, `not-in-can`, …); `null` when allowed. */
  refusal: string | null;
}

export interface BotLogPage {
  /** Older than this entry id; absent for the newest. */
  before?: number;
  limit?: number;
}

/**
 * A grant change refused because the grant is not what the caller read: another change came first
 * (`version`, with the version it has now when the backend says), or the bot is revoked for good.
 */
export class BotGrantConflict extends Error {
  readonly reason: 'version' | 'revoked';
  readonly version: number | null;

  constructor(reason: 'version' | 'revoked', message: string, version: number | null = null) {
    super(message);
    this.name = 'BotGrantConflict';
    this.reason = reason;
    this.version = version;
  }
}

/** Whether `error` is a {@link BotGrantConflict}, across bundles that each carry the class. */
export function isBotGrantConflict(error: unknown): error is BotGrantConflict {
  return error instanceof BotGrantConflict || (error as { name?: unknown } | null)?.name === 'BotGrantConflict';
}

export interface BotPort {
  /** The person's bots, oldest first. */
  list(): Promise<BotView[]>;
  grant(bot: string): Promise<BotView>;
  /**
   * Makes a bot that claims `offer` (from the `add-bot` change) and names it `name`. Answers the
   * match code and the bot's credential, once.
   */
  create(offer: string, name: string): Promise<CreatedBotView>;
  /** Replaces the grant; a stale `version` or a revoked bot rejects with {@link BotGrantConflict}. */
  setGrant(bot: string, grant: BotGrantInput): Promise<BotView>;
  /** The bot's activity, newest first. */
  log(bot: string, page?: BotLogPage): Promise<BotActivityView[]>;
}
