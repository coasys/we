/**
 * The Bots page's words: a bot as a row, its grant as a draft the editor changes, and an activity
 * entry as a line. Pure, so the wording and the draft rules are tested without a store.
 *
 * A grant names spaces as the backend matches them: a shared space by its neighbourhood URL (the
 * bot reaches it through its own copy). A space the grant names that is not one of the person's
 * here is kept, and shown as such, so saving never drops it unseen.
 */
import type { BotAction, BotActivityView, BotGrantInput, BotGrantState, BotKeyView, BotView } from '@we/backend-shared';

const DAY = 86_400;

/** The actions in the order the page lists them, with what each lets a bot do. */
export const BOT_ACTION_LABELS: ReadonlyArray<{ action: BotAction; label: string }> = [
  { action: 'read', label: 'Allow reading' },
  { action: 'write', label: 'Allow writing, with a reason each time' },
  { action: 'join', label: 'Allow joining' },
];

/** A date as the page shows it, in the person's own locale. */
export function dateOf(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** A moment as the activity log shows it. */
export function momentOf(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** A space the person has here, as the grant names it. */
export interface GrantSpace {
  /** The shared space's neighbourhood URL. */
  id: string;
  /** The space's id here. The activity log names a write's space by it, and a join's by the URL. */
  uuid: string;
  name: string;
}

/**
 * The person's shared spaces as a grant names them, from `spaceStore.mySpaces`. A bot is an agent of
 * its own: it reaches a space only by joining its neighbourhood, so a personal space is never one it
 * could be given. `Space.url` keeps only the CID, and the backend matches a bot's join by the whole
 * URL, so the URL is rebuilt.
 */
export function grantSpaces(
  spaces: ReadonlyArray<{ uuid: string; url?: string | null; name?: string | null }>,
): GrantSpace[] {
  return spaces.flatMap((s) =>
    s.url ? [{ id: neighbourhoodUrl(s.url), uuid: s.uuid, name: s.name?.trim() || 'Untitled space' }] : [],
  );
}

/** A shared space's neighbourhood URL, from its CID or from a URL already whole. */
export function neighbourhoodUrl(url: string): string {
  return url.includes('://') ? url : `neighbourhood://${url}`;
}

export interface BotRow {
  did: string;
  name: string;
  state: BotGrantState;
  /** 'Active', 'Paused', 'Removed', or 'Not confirmed' while its key is not in the log. */
  status: string;
  statusTone: 'success' | 'warning' | 'danger' | 'neutral';
  /** What the key log says of its key, and until when. */
  keyLine: string;
  keyTone: 'text-muted' | 'warning-text' | 'danger-text';
  /** What the grant lets it do now: '2 spaces · read, write · until 3 Dec 2026', or that it may do nothing. */
  grantLine: string;
  created: string;
  paused: boolean;
  revoked: boolean;
  /** Its key is in the key log and valid: a grant can let it act. */
  keyValid: boolean;
}

/** What a bot whose key is not in the key log yet waits for. */
const CONFIRM_MATCH = 'Confirm the match code in the identity window';

function keyLine(key: BotKeyView | null): { line: string; tone: BotRow['keyTone'] } {
  if (!key) return { line: CONFIRM_MATCH, tone: 'warning-text' };
  const until = key.expires === null ? '' : ` until ${dateOf(key.expires)}`;
  switch (key.verdict) {
    case 'valid':
      return { line: `Key valid${until} · allows ${key.can.join(', ') || 'nothing'}`, tone: 'text-muted' };
    case 'expired':
      return {
        line: `Key expired${key.expires === null ? '' : ` on ${dateOf(key.expires)}`}`,
        tone: 'danger-text',
      };
    case 'revoked':
      return { line: 'Key removed', tone: 'danger-text' };
    case 'not-in-log':
      return { line: CONFIRM_MATCH, tone: 'warning-text' };
  }
}

function grantLine(bot: BotView): string {
  const { grant } = bot;
  if (grant.state === 'revoked') return "Can't do anything";
  if (!grant.spaces.length || !grant.can.length) return 'No permissions yet';
  const spaces = grant.spaces.length === 1 ? '1 space' : `${grant.spaces.length} spaces`;
  const until = grant.expires === null ? '' : ` · until ${dateOf(grant.expires)}`;
  return `${spaces} · ${grant.can.join(', ')}${until}`;
}

export function botRow(bot: BotView): BotRow {
  const key = keyLine(bot.key);
  const keyValid = bot.key?.verdict === 'valid';
  const state = bot.grant.state;
  const [status, statusTone]: [string, BotRow['statusTone']] =
    state === 'revoked'
      ? ['Removed', 'danger']
      : state === 'paused'
        ? ['Paused', 'warning']
        : keyValid
          ? ['Active', 'success']
          : ['Not confirmed', 'neutral'];
  return {
    did: bot.did,
    name: bot.name || 'Unnamed bot',
    state,
    status,
    statusTone,
    keyLine: key.line,
    keyTone: key.tone,
    grantLine: grantLine(bot),
    created: `Added ${dateOf(bot.createdAt)}`,
    paused: state === 'paused',
    revoked: state === 'revoked',
    keyValid,
  };
}

/** The grant editor's state: what will be sent, before it is. */
export interface GrantDraft {
  did: string;
  spaces: string[];
  can: BotAction[];
  /** Days from now the grant ends, as typed; empty for no end but the key's. */
  days: string;
  /** The grant's end as read, kept while `days` is untouched so a save does not move it. */
  expires: number | null;
  state: BotGrantState;
  version: number;
}

export function draftOf(bot: BotView): GrantDraft {
  return {
    did: bot.did,
    spaces: [...bot.grant.spaces],
    can: [...bot.grant.can],
    days: '',
    expires: bot.grant.expires,
    state: bot.grant.state,
    version: bot.grant.version,
  };
}

/** `list` with `item` added or taken out, in the order of `order` where it names it. */
function toggled<T>(list: T[], item: T, order: readonly T[] = []): T[] {
  const next = list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  return order.length ? [...order.filter((x) => next.includes(x)), ...next.filter((x) => !order.includes(x))] : next;
}

export const toggleSpace = (draft: GrantDraft, id: string): GrantDraft => ({
  ...draft,
  spaces: toggled(draft.spaces, id),
});

export const toggleAction = (draft: GrantDraft, action: BotAction): GrantDraft => ({
  ...draft,
  can: toggled(draft.can, action, ['read', 'write', 'join']),
});

/** Why the draft cannot be saved, in words a person reads; empty when it can. */
export function draftProblem(draft: GrantDraft, key: BotKeyView | null): string {
  const days = draft.days.trim();
  if (days && !(/^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 3650)) {
    return 'Enter 1 to 3650 days, or leave it empty.';
  }
  if (draft.spaces.length > 100) return 'Choose up to 100 spaces.';
  const outside = key ? draft.can.filter((a) => !key.can.includes(a)) : [];
  if (outside.length) return `This bot can't ${outside.join(' or ')}. To allow it, add the bot again.`;
  return '';
}

/** The grant the draft sends, `now` in unix seconds. */
export function grantInput(draft: GrantDraft, now: number): BotGrantInput {
  const days = draft.days.trim();
  return {
    spaces: draft.spaces,
    can: draft.can,
    expires: days ? now + Number(days) * DAY : draft.expires,
    state: draft.state,
    version: draft.version,
  };
}

/** When the draft's grant ends, as the editor says it. */
export function draftEnds(draft: GrantDraft, key: BotKeyView | null, now: number): string {
  const days = draft.days.trim();
  const ends = days && /^\d+$/.test(days) ? now + Number(days) * DAY : draft.expires;
  const keyEnds = key?.expires ?? null;
  if (ends === null) return keyEnds === null ? 'No end set.' : `Ends on ${dateOf(keyEnds)}, when its key ends.`;
  if (keyEnds !== null && keyEnds < ends) return `Ends on ${dateOf(keyEnds)}, when its key ends.`;
  return `Ends on ${dateOf(ends)}.`;
}

/** Why a call was refused, in words. Unknown codes are shown as they came. */
const REFUSALS: Record<string, string> = {
  'reason-required': 'No reason given',
  'bot-grant': 'Not allowed',
  'bot-paused': 'Paused',
  'bot-revoked': 'Removed',
  'bot-expired': 'Permissions had ended',
  'not-in-can': 'Action not allowed',
  'bot-unbound': 'Not confirmed',
  'invalid:not-in-scope': "Key doesn't allow this",
};

export interface ActivityRow {
  id: number;
  when: string;
  allowed: boolean;
  /** 'Allowed', or 'Blocked: ' and why. */
  outcome: string;
  /** What it did: 'write in Garden club', 'read', 'agent.status'. */
  what: string;
  /** The reason the bot gave, or that it gave none. */
  reason: string;
}

export function activityRow(entry: BotActivityView, spaces: GrantSpace[]): ActivityRow {
  const where = entry.space
    ? (spaces.find((s) => s.id === entry.space || s.uuid === entry.space)?.name ?? entry.space)
    : '';
  const what = entry.action ? `${entry.action}${where ? ` in ${where}` : ''}` : entry.method;
  return {
    id: entry.id,
    when: momentOf(entry.at),
    allowed: entry.allowed,
    outcome: entry.allowed ? 'Allowed' : `Blocked: ${REFUSALS[entry.refusal ?? ''] ?? entry.refusal ?? 'blocked'}`,
    what,
    reason: entry.reason ? `“${entry.reason}”` : 'No reason given',
  };
}
