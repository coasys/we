/**
 * BotStore — the person's bots: making one, what each may do (its grant), pausing, resuming and
 * revoking it, and what it did.
 *
 * A bot needs two things, from two places. Its **key** joins the person's key log, which only a
 * computer that keeps the master key can sign: `addBot` asks for that as an identity change
 * (`add-bot`), and the identity window shows an offer. The bot's **agent** is made here, from that
 * offer (`create`): the backend answers the match code the identity window asks the person to check,
 * and the bot's credential. The credential is shown once and let go: when the person dismisses it
 * (`dismissCreated`) or leaves the page it was shown on. It is never kept beyond that, nor logged.
 * Letting it go only forgets it on this side: it does not revoke or expire it on the backend.
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
import { useShellStore } from './ShellStore';
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
  /**
   * The bot's credential, for the program that runs it. Gone after `dismissCreated`, or once the
   * person leaves the page it was shown on.
   */
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
  /** The bot just made, until `dismissCreated` or until the person leaves the page. */
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
  /**
   * Removes the bot for good: ends its grant (a revoked grant never changes again) and revokes its
   * key in the person's key log. True only when both are done. When the grant is ended but the key
   * could not be revoked, it is false, `keyRevokeError` says so and calling it again retries the key.
   */
  revoke: () => Promise<boolean>;
  /** Why the bot's key could not be revoked, when its grant is already ended: the key is still valid. Empty otherwise. */
  keyRevokeError: Accessor<string>;
  /** Removing is running. */
  revoking: Accessor<boolean>;
  loadOlder: () => Promise<void>;
}

const BotStoreContext = createContext<BotStore>();

const now = () => Math.floor(Date.now() / 1000);
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function BotStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const identity = useIdentityStore();
  const spaces = useSpaceStore();
  const shell = useShellStore();
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
  const [revoking, setRevoking] = createSignal(false);
  // Tied to the bot it concerns: removing goes on if the person opens another bot, and the notice must not follow them.
  const [keyFailure, setKeyFailure] = createSignal<{ did: string; message: string } | null>(null);
  const keyRevokeError = () => (keyFailure()?.did === selectedDid() ? (keyFailure()?.message ?? '') : '');
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
      setKeyFailure(null);
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

  /*
    The credential is for the person to copy, once, from the page that made the bot. Any chrome
    template can read this store, so it is not left here after that page is gone: leaving the page
    (another settings page, or the overlay closed) lets it go, as dismissing it does.
  */
  let navigations = 0;
  createEffect(
    on(
      () => shell.shellPage(),
      () => {
        // Any navigation ends every create still in flight (its reply is dropped, below) and lets go
        // of a credential on show. Away and back counts: it is not the page the reply was asked on.
        navigations++;
        setCreated(null);
      },
      { defer: true },
    ),
  );

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
        d.state !== read.state ||
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
      // The bot is the one asked for, not whichever is open now: the selection can move between steps.
      const bot = raw().find((b) => b.did === did) ?? (await p.grant(did));
      if (port() !== p) return false;
      const saved = await p.setGrant(did, grantInput(next(bot), now()));
      if (port() !== p) return false;
      take(saved, true);
      setError('');
      return true;
    } catch (e) {
      if (port() !== p) return false;
      if (isBotGrantConflict(e)) {
        if (selectedDid() === did) setConflict(e.message);
        try {
          const latest = await p.grant(did);
          if (port() === p) take(latest, true);
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
  async function setState(state: BotGrantState, target?: string): Promise<boolean> {
    const did = target ?? selectedDid();
    const p = port();
    if (!did || !p) return false;
    let fresh: BotView;
    try {
      // Read first: a pause must not undo a grant change made elsewhere since this page read it.
      fresh = await p.grant(did);
      if (port() !== p) return false;
      take(fresh, false);
    } catch (e) {
      setError(message(e));
      return false;
    }
    // The editor's draft is only this bot's while it is the one open.
    const kept = selectedDid() === did ? draft() : null;
    // The edit in progress started from the grant at `kept.version`. The same version now means
    // nothing changed elsewhere, so the edit may go on over the pause; a newer one means it did,
    // and giving the old draft the new version would let a Save restore what was removed, with
    // no conflict to show it. Then the page shows the grant as it is now and says so.
    const unchanged = !!kept && fresh.grant.version === kept.version;
    const ok = await send(did, (bot) => ({ ...draftOf(bot), state }));
    // A pause keeps an edit in progress; a revoke ends every edit.
    if (ok && kept && state !== 'revoked' && selectedDid() === did) {
      if (unchanged)
        setDraft({ ...kept, state, version: raw().find((b) => b.did === did)?.grant.version ?? kept.version });
      else setConflict('These permissions changed while you were editing. Showing the latest.');
    }
    return ok;
  }

  /**
    Removing a bot ends two things, and either can be left undone. The grant is held by the backend
    that runs the bot; the key is in the person's key log, which every other computer reads, and
    ends only by an identity change signed where the master key is kept. So the grant is ended
    first, and then the key through the identity store's own `revoke` change, the one a device's key
    goes through. A key left valid is said so and retried by calling this again: the grant is
    already ended then, and is not sent twice.
  */
  async function remove(): Promise<boolean> {
    const did = selectedDid();
    if (!did || revoking()) return false;
    const p = port();
    if (!p) return false;
    setRevoking(true);
    setKeyFailure(null);
    // Both steps are bound to this bot and this port: the person may open another bot, or close this
    // one, while the grant is being ended, and the key that goes is still this bot's.
    const find = () => raw().find((b) => b.did === did);
    try {
      let bot = find();
      if (bot?.grant.state !== 'revoked') {
        if (!(await setState('revoked', did))) return false;
        if (port() !== p) return false;
        bot = find();
      }
      const key = bot?.key;
      // No key in the log (never confirmed), or one the log already ends: nothing left to revoke.
      if (!key || key.verdict !== 'valid') return true;
      const outcome = await identity.open({ kind: 'revoke', keyId: key.keyId });
      await refresh();
      if (port() !== p) return false;
      if (outcome === 'done') return true;
      const why = outcome === 'cancelled' ? 'It was cancelled.' : identity.error() || 'It did not go through.';
      setKeyFailure({
        did,
        message: `The bot's permissions are ended, but its key is still valid on your other computers. ${why} Try again to revoke the key.`,
      });
      return false;
    } finally {
      setRevoking(false);
    }
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
        setCreateError('Paste the setup code from the identity window.');
        return false;
      }
      setCreating(true);
      setCreateError('');
      const askedAt = navigations;
      try {
        const made = await p.create(offer, name);
        if (askedAt !== navigations || port() !== p) {
          // The person left the page while this was pending. The bot exists, so it is listed, but its
          // credential is not shown where it was never asked for; it is simply not kept.
          setCreateError(
            'The bot was made, but you left the page before its credential could be shown, so it was not kept. The bot is in your list: remove it and make a new one to get a credential.',
          );
          await refresh();
          return false;
        }
        setCreated({
          name: name.trim() || 'Unnamed bot',
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
    revoke: remove,
    keyRevokeError,
    revoking,
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
