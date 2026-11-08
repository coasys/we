/**
 * BotStore — the person's bots: making one, what each may do (its grant), pausing, resuming and
 * revoking it, and what it did.
 *
 * A bot needs two things, from two places. Its **key** joins the person's key log, which only a
 * computer that keeps the master key can sign: `addBot` asks for that as an identity change
 * (`add-bot`), and the identity window shows an offer. The bot's **agent** is made here, from that
 * offer (`create`): the backend answers the match code the identity window asks the person to check,
 * and the bot's credential. The credential is shown once and let go (`dismissCreated`); it is never
 * kept beyond that, nor logged.
 *
 * The grant is replaced whole and names the version it replaces. When another change came first
 * the save is refused, the grant is read again and shown as it is now, with a line that says so.
 *
 * Chrome tier only (`bots` in `templateSurface.ts`): a space template never sees a person's bots.
 */
import {
  type ActivityRow,
  activityRow,
  BOT_ACTION_LABELS,
  type BotRow,
  botRow,
  draftEnds,
  draftOf,
  draftProblem,
  type GrantDraft,
  grantInput,
  grantSpaces,
  toggleAction as toggledAction,
  toggleSpace as toggledSpace,
} from '@shared/botRows';
import {
  type BotAction,
  type BotActivityView,
  type BotGrantState,
  type BotPort,
  type BotView,
  type IdentityChangeOutcome,
  isBotGrantConflict,
} from '@we/backend-shared';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createSignal,
  on,
  type ParentProps,
  useContext,
} from 'solid-js';

import { useIdentityStore } from './IdentityStore';
import { useSessionStore } from './SessionStore';
import { useSpaceStore } from './SpaceStore';

/** How many activity entries one read asks for. */
export const BOT_LOG_PAGE = 50;

/** A bot just made, as the page shows it once. */
export interface CreatedBotCard {
  name: string;
  /** The code the identity window shows too: the person checks they match. */
  matchCode: string;
  /** Until when the person can confirm it there. */
  confirmBy: string;
  /** The bot's credential, for the program that runs it. Gone after `dismissCreated`. */
  token: string;
}

/** One of the person's spaces in the grant editor. */
export interface DraftSpaceRow {
  id: string;
  name: string;
  checked: boolean;
  /** False for a space the grant names that is not one of the person's here: kept, and said so. */
  known: boolean;
}

/** One action in the grant editor. */
export interface DraftActionRow {
  action: BotAction;
  label: string;
  checked: boolean;
  /** The bot's key may take it: the grant cannot give more than the key. */
  allowed: boolean;
}

/** The grant editor, worded. */
export interface GrantEditor {
  spaces: DraftSpaceRow[];
  actions: DraftActionRow[];
  /** The days as typed. */
  days: string;
  /** When the grant would end. */
  ends: string;
  /** Why it cannot be saved; empty when it can. */
  problem: string;
  /** The draft differs from the grant as read. */
  changed: boolean;
}

export interface BotStore {
  /** This backend runs bots. */
  available: Accessor<boolean>;
  /**
   * "Add a bot" can be offered: this computer keeps the master key, which signs the bot's key into
   * the key log.
   */
  canAdd: Accessor<boolean>;
  bots: Accessor<BotRow[]>;
  loaded: Accessor<boolean>;
  /** Why the last read or change failed; empty when it did not. */
  error: Accessor<string>;
  /** The bot just made, until `dismissCreated`. */
  created: Accessor<CreatedBotCard | null>;
  /** Why making the bot failed; empty when it did not. */
  createError: Accessor<string>;
  creating: Accessor<boolean>;
  /** The bot open in the editor, or null for the list. */
  selected: Accessor<BotRow | null>;
  editor: Accessor<GrantEditor | null>;
  /** A grant change was refused because another came first: what was done about it. */
  conflict: Accessor<string>;
  saving: Accessor<boolean>;
  activity: Accessor<ActivityRow[]>;
  activityLoaded: Accessor<boolean>;
  /** The last read filled a page: older entries may follow. */
  hasOlder: Accessor<boolean>;
  loadingOlder: Accessor<boolean>;

  refresh: () => Promise<void>;
  /** Opens the identity window's `add-bot` step, which shows the offer to paste here. */
  addBot: () => Promise<IdentityChangeOutcome>;
  /** Makes the bot from the offer the identity window shows. */
  create: (offer: string, name: string) => Promise<boolean>;
  /** Lets the credential go. */
  dismissCreated: () => void;
  select: (did: string) => Promise<void>;
  close: () => void;
  toggleSpace: (id: string) => void;
  toggleAction: (action: BotAction) => void;
  setDays: (days: string) => void;
  /** Puts the editor back to the grant as read. */
  resetDraft: () => void;
  saveGrant: () => Promise<boolean>;
  pause: () => Promise<boolean>;
  resume: () => Promise<boolean>;
  /** For good: a revoked grant never changes again. */
  revoke: () => Promise<boolean>;
  loadOlder: () => Promise<void>;
}

const BotStoreContext = createContext<BotStore>();

const now = () => Math.floor(Date.now() / 1000);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function BotStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const identity = useIdentityStore();
  const spaces = useSpaceStore();
  const port = (): BotPort | null => session.backendPorts()?.identity?.bots ?? null;
  const available = () => session.identityCapabilities().bots && !!port();

  const [raw, setRaw] = createSignal<BotView[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [error, setError] = createSignal('');
  const [created, setCreated] = createSignal<CreatedBotCard | null>(null);
  const [createError, setCreateError] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [selectedDid, setSelectedDid] = createSignal<string | null>(null);
  const [draft, setDraft] = createSignal<GrantDraft | null>(null);
  const [conflict, setConflict] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [entries, setEntries] = createSignal<BotActivityView[]>([]);
  const [activityLoaded, setActivityLoaded] = createSignal(false);
  const [hasOlder, setHasOlder] = createSignal(false);
  const [loadingOlder, setLoadingOlder] = createSignal(false);

  // A reply belongs to the port it was asked of and to the latest read, as in the device store.
  let generation = 0;
  createEffect(
    on(port, () => {
      generation++;
      setRaw([]);
      setLoaded(false);
      setError('');
      setCreated(null);
      setSelectedDid(null);
      setDraft(null);
      setEntries([]);
      setActivityLoaded(false);
    }),
  );

  async function refresh(): Promise<void> {
    const p = port();
    if (!p || !available()) return;
    const asked = ++generation;
    try {
      const next = identity.did() ? await p.list() : [];
      if (asked !== generation || port() !== p) return;
      setRaw(next);
      setLoaded(true);
      setError('');
    } catch (e) {
      if (asked !== generation || port() !== p) return;
      setError(message(e));
    }
  }

  // The list follows the key log: a bot's key verdict changes when the log does.
  createEffect(() => {
    if (!available()) return;
    if (identity.keyLogLoaded()) identity.keyLog();
    identity.did();
    void refresh();
  });

  /** Puts one bot, as just read, in the list and, when it is open, in the editor. */
  function take(bot: BotView, resetDraft: boolean): void {
    setRaw((list) =>
      list.some((b) => b.did === bot.did) ? list.map((b) => (b.did === bot.did ? bot : b)) : [...list, bot],
    );
    if (selectedDid() === bot.did && resetDraft) setDraft(draftOf(bot));
  }

  const selectedBot = () => raw().find((b) => b.did === selectedDid()) ?? null;
  const known = createMemo(() => grantSpaces(spaces.mySpaces()));

  const editor = createMemo<GrantEditor | null>(() => {
    const d = draft();
    const bot = selectedBot();
    if (!d || !bot) return null;
    const mine = known();
    const others = d.spaces.filter((id) => !mine.some((s) => s.id === id));
    const read = draftOf(bot);
    return {
      spaces: [
        ...mine.map((s) => ({ id: s.id, name: s.name, checked: d.spaces.includes(s.id), known: true })),
        ...others.map((id) => ({ id, name: id, checked: true, known: false })),
      ],
      actions: BOT_ACTION_LABELS.map(({ action, label }) => ({
        action,
        label,
        checked: d.can.includes(action),
        allowed: !bot.key || bot.key.can.includes(action),
      })),
      days: d.days,
      ends: draftEnds(d, bot.key, now()),
      problem: draftProblem(d, bot.key),
      changed:
        d.days.trim() !== '' ||
        d.spaces.length !== read.spaces.length ||
        d.spaces.some((s) => !read.spaces.includes(s)) ||
        d.can.join() !== read.can.join(),
    };
  });

  async function readActivity(did: string, before?: number): Promise<void> {
    const p = port();
    if (!p) return;
    const page = await p.log(did, { before, limit: BOT_LOG_PAGE });
    if (selectedDid() !== did || port() !== p) return;
    setEntries((old) =>
      before === undefined ? page : [...old, ...page.filter((e) => !old.some((o) => o.id === e.id))],
    );
    setHasOlder(page.length >= BOT_LOG_PAGE);
    setActivityLoaded(true);
  }

  async function select(did: string): Promise<void> {
    const p = port();
    if (!p) return;
    setSelectedDid(did);
    setConflict('');
    setEntries([]);
    setActivityLoaded(false);
    setHasOlder(false);
    const listed = raw().find((b) => b.did === did);
    if (listed) setDraft(draftOf(listed));
    try {
      const bot = await p.grant(did);
      if (selectedDid() !== did) return;
      take(bot, true);
      await readActivity(did);
    } catch (e) {
      if (selectedDid() === did) setError(message(e));
    }
  }

  /** Sends `next` as the grant; on a conflict, reads the grant again and shows it as it is now. */
  async function send(did: string, next: (bot: BotView) => GrantDraft): Promise<boolean> {
    const p = port();
    if (!p || saving()) return false;
    setSaving(true);
    setConflict('');
    try {
      const bot = selectedBot() ?? (await p.grant(did));
      const saved = await p.setGrant(did, grantInput(next(bot), now()));
      take(saved, true);
      setError('');
      return true;
    } catch (e) {
      if (isBotGrantConflict(e)) {
        setConflict(e.message);
        try {
          take(await p.grant(did), true);
        } catch (again) {
          setError(message(again));
        }
      } else {
        setError(message(e));
      }
      return false;
    } finally {
      setSaving(false);
      if (selectedDid() === did) void readActivity(did).catch(() => undefined);
    }
  }

  /** A change of state only: the rest of the grant as read, so an unsaved edit is not sent with it. */
  async function setState(state: BotGrantState): Promise<boolean> {
    const did = selectedDid();
    const p = port();
    if (!did || !p) return false;
    try {
      // Read first: a pause must not undo a grant change made elsewhere since this page read it.
      take(await p.grant(did), false);
    } catch (e) {
      setError(message(e));
      return false;
    }
    const kept = draft();
    const ok = await send(did, (bot) => ({ ...draftOf(bot), state }));
    // A pause keeps an edit in progress; a revoke ends every edit.
    if (ok && kept && state !== 'revoked')
      setDraft({ ...kept, state, version: selectedBot()?.grant.version ?? kept.version });
    return ok;
  }

  const store: BotStore = {
    available,
    canAdd: () => available() && identity.canChange() && !!identity.did() && !!identity.custody()?.holdsMaster,
    bots: createMemo(() => raw().map(botRow)),
    loaded,
    error,
    created,
    createError,
    creating,
    selected: createMemo(() => {
      const bot = selectedBot();
      return bot ? botRow(bot) : null;
    }),
    editor,
    conflict,
    saving,
    activity: createMemo(() => entries().map((e) => activityRow(e, known()))),
    activityLoaded,
    hasOlder,
    loadingOlder,

    refresh,
    addBot: async () => {
      const outcome = await identity.open({ kind: 'add-bot' });
      await refresh();
      return outcome;
    },
    create: async (offer: string, name: string) => {
      const p = port();
      if (!p || creating()) return false;
      if (!offer.trim()) {
        setCreateError('Paste the offer the identity window shows.');
        return false;
      }
      setCreating(true);
      setCreateError('');
      try {
        const made = await p.create(offer, name);
        setCreated({
          name: name.trim() || 'A bot',
          matchCode: made.matchCode,
          confirmBy: new Date(made.expires * 1000).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          }),
          token: made.token,
        });
        await refresh();
        return true;
      } catch (e) {
        setCreateError(message(e));
        return false;
      } finally {
        setCreating(false);
      }
    },
    dismissCreated: () => setCreated(null),
    select,
    close: () => {
      setSelectedDid(null);
      setDraft(null);
      setConflict('');
      setEntries([]);
      setActivityLoaded(false);
    },
    toggleSpace: (id: string) => setDraft((d) => (d ? toggledSpace(d, id) : d)),
    toggleAction: (action: BotAction) => setDraft((d) => (d ? toggledAction(d, action) : d)),
    setDays: (days: string) => setDraft((d) => (d ? { ...d, days: String(days ?? '') } : d)),
    resetDraft: () => {
      const bot = selectedBot();
      setDraft(bot ? draftOf(bot) : null);
      setConflict('');
    },
    saveGrant: async () => {
      const did = selectedDid();
      const d = draft();
      const bot = selectedBot();
      if (!did || !d || !bot || draftProblem(d, bot.key)) return false;
      return send(did, () => d);
    },
    pause: () => setState('paused'),
    resume: () => setState('active'),
    revoke: () => setState('revoked'),
    loadOlder: async () => {
      const did = selectedDid();
      const list = entries();
      const last = list[list.length - 1];
      if (!did || !last || loadingOlder()) return;
      setLoadingOlder(true);
      try {
        await readActivity(did, last.id);
      } catch (e) {
        setError(message(e));
      } finally {
        setLoadingOlder(false);
      }
    },
  };

  return <BotStoreContext.Provider value={store}>{props.children}</BotStoreContext.Provider>;
}

export function useBotStore(): BotStore {
  const store = useContext(BotStoreContext);
  if (!store) throw new Error('useBotStore must be used within BotStoreProvider');
  return store;
}
