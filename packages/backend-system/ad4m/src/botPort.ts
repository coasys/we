/**
 * The bot port over AD4M's `bot.*` calls (`Ad4mClient.bot`).
 *
 * The executor runs the bots: it makes a bot's agent and claims the person's bot offer with its key
 * (`bot.createAgent`), holds each grant and judges each of the bot's calls by it, and logs what the
 * bot did and what it was refused. These calls are the operator's, or an app's on the main agent,
 * which sees only the bots of the main agent's identity.
 *
 * What is translated here, and nowhere above: the executor's 409s on `bot.setGrant` (a stale
 * `version`, a revoked grant) become a neutral {@link BotGrantConflict}; `notInLog` becomes
 * `not-in-log`; an activity's `outcome` (`allowed`, or the refusal's code) becomes `allowed` and
 * `refusal`. The credential `createAgent` answers is passed up once and never kept or logged here.
 */
import {
  BOT_ACTIONS,
  type BotAction,
  type BotActivityView,
  BotGrantConflict,
  type BotGrantInput,
  type BotGrantState,
  type BotGrantView,
  type BotKeyVerdict,
  type BotKeyView,
  type BotPort,
  type BotView,
  type CreatedBotView,
} from '@we/backend-shared';

import { rpcStatus } from './rpcStatus';

/** The slice of `Ad4mClient.bot` this port uses, so a test can stand one in. */
export interface BotClientLike {
  createAgent(offer: string, name: string): Promise<unknown>;
  setGrant(
    bot: string,
    grant: { spaces: string[]; can: BotAction[]; expires?: number | null; state: BotGrantState; version: number },
  ): Promise<unknown>;
  grant(bot: string): Promise<unknown>;
  list(): Promise<unknown>;
  log(bot: string, options?: { before?: number; limit?: number }): Promise<unknown>;
}

type Raw = Record<string, unknown>;

const record = (value: unknown): Raw => (value && typeof value === 'object' ? (value as Raw) : {});
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const actions = (value: unknown): BotAction[] =>
  (Array.isArray(value) ? value : []).filter((a): a is BotAction => BOT_ACTIONS.includes(a as BotAction));

const STATES: readonly BotGrantState[] = ['active', 'paused', 'revoked'];
const VERDICTS: Record<string, BotKeyVerdict> = {
  valid: 'valid',
  revoked: 'revoked',
  expired: 'expired',
  notInLog: 'not-in-log',
};

export function readGrant(value: unknown): BotGrantView {
  const grant = record(value);
  const state = STATES.find((s) => s === grant.state);
  return {
    spaces: (Array.isArray(grant.spaces) ? grant.spaces : []).filter((s): s is string => typeof s === 'string'),
    can: actions(grant.can),
    expires: count(grant.expires),
    // A state this build does not know is read as the safest one: nothing is offered but revoke.
    state: state ?? 'paused',
    version: count(grant.version) ?? 0,
    updatedAt: count(grant.updatedAt) ?? 0,
  };
}

function readKey(value: unknown): BotKeyView | null {
  if (!value || typeof value !== 'object') return null;
  const key = record(value);
  return {
    keyId: text(key.keyId) ?? '',
    // A verdict this build does not know is not a valid key.
    verdict: VERDICTS[text(key.verdict) ?? ''] ?? 'not-in-log',
    can: actions(key.can),
    expires: count(key.expires),
  };
}

export function readBot(value: unknown): BotView {
  const bot = record(value);
  return {
    did: text(bot.did) ?? '',
    name: text(bot.name) ?? '',
    owner: text(bot.owner) ?? '',
    createdAt: count(bot.createdAt) ?? 0,
    grant: readGrant(bot.grant),
    key: readKey(bot.key),
  };
}

export function readActivity(value: unknown): BotActivityView {
  const entry = record(value);
  const outcome = text(entry.outcome) ?? '';
  const action = BOT_ACTIONS.find((a) => a === entry.action) ?? null;
  return {
    id: count(entry.id) ?? 0,
    at: count(entry.at) ?? 0,
    method: text(entry.method) ?? '',
    action,
    space: text(entry.space),
    reason: text(entry.reason),
    allowed: outcome === 'allowed',
    refusal: outcome === 'allowed' ? null : outcome || 'refused',
  };
}

/**
 * A `bot.setGrant` refusal as the shell reads it: the executor answers 409 `version: the grant
 * changed, its version is now N` for a stale version and 409 `bot-revoked: …` for a revoked grant.
 * Anything else is passed on as it came.
 */
export function grantRefusal(error: unknown): unknown {
  if (rpcStatus(error) !== 409) return error;
  const body = text((error as { body?: unknown }).body) ?? (error instanceof Error ? error.message : '');
  if (/bot-revoked/.test(body)) {
    return new BotGrantConflict('revoked', "This bot was removed, so its permissions can't change.");
  }
  if (/version/.test(body)) {
    const now = /version is now (\d+)/.exec(body);
    return new BotGrantConflict(
      'version',
      'These permissions changed while you were editing. Showing the latest.',
      now ? Number(now[1]) : null,
    );
  }
  return error;
}

export function createAd4mBotPort(bot: BotClientLike): BotPort {
  return {
    async list() {
      const bots = await bot.list();
      return (Array.isArray(bots) ? bots : []).map(readBot);
    },

    async grant(did: string) {
      return readBot(await bot.grant(did));
    },

    async create(offer: string, name: string): Promise<CreatedBotView> {
      const made = record(await bot.createAgent(offer.trim(), name.trim()));
      return {
        did: text(made.did) ?? '',
        owner: text(made.owner) ?? '',
        matchCode: text(made.matchCode) ?? '',
        expires: count(made.expires) ?? 0,
        token: text(made.token) ?? '',
      };
    },

    async setGrant(did: string, grant: BotGrantInput) {
      try {
        return readBot(
          await bot.setGrant(did, {
            spaces: grant.spaces,
            can: grant.can,
            expires: grant.expires,
            state: grant.state,
            version: grant.version,
          }),
        );
      } catch (error) {
        throw grantRefusal(error);
      }
    },

    async log(did: string, page = {}) {
      const entries = await bot.log(did, { before: page.before, limit: page.limit });
      return (Array.isArray(entries) ? entries : []).map(readActivity);
    },
  };
}
