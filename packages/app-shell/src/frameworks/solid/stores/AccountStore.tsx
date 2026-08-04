/**
 * AccountStore — which local accounts exist, and switching between them.
 *
 * The Solid binding over `PlatformAdapter.accounts`. Unusually for a store, it reads nothing from
 * the backend: an account is a directory on disk, and the list of them is knowable before any
 * executor is running. That is the point — the boot screen needs it while the session is still
 * locked, which is exactly when no backend question can be answered.
 *
 * Switching and creating end in a restart. The executor is configured with one data path at
 * startup and holds it for its lifetime, so "switch account" cannot mean anything else; the ADAM
 * launcher quits the app for the same reason.
 *
 * Creating deliberately collects no name. It makes an empty directory under a provisional name and
 * restarts into it, where the setup screen asks for the name *and* the password together — the
 * same single page a genuine first run sees. Collecting the name before the restart and the
 * password after would give the one act two shapes depending on how it was reached.
 *
 * Absent on web, where `accounts` is undefined: `canManageAccounts` stays false and the boot
 * screen renders no account controls.
 */
import type { Account } from '@shared/platform/types';
import { usePlatform } from '@solid/providers/PlatformProvider';
import {
  type Accessor,
  createContext,
  createMemo,
  createSignal,
  onMount,
  type ParentProps,
  useContext,
} from 'solid-js';

/**
 * The last-known account list, so the sign-in screen can draw itself before any IPC has answered.
 *
 * Switching tears the document down and rebuilds it, and the real list arrives over IPC several
 * frames after first paint. Anything bound to it renders empty and then pops in — which is exactly
 * why the corner switcher vanished and came back on every switch while the centre badge did not:
 * the badge already read a cache, and the corner did not.
 *
 * `localStorage` because it is synchronous, and because it works on both desktop hosts — Tauri's
 * `invoke` is async-only, so a sync-IPC version would leave one host still popping.
 *
 * Staleness is bounded to a few frames: the real list replaces this as soon as it lands.
 */
const CACHE_KEY = 'we:accounts';

function readCachedAccounts(): Account[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a) => a?.id && a?.name) : [];
  } catch {
    // Unavailable or corrupt — the screen simply starts empty, which is where it was before.
    return [];
  }
}

function writeCachedAccounts(accounts: Account[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(accounts));
  } catch {
    // Best effort. A stale or missing cache costs a frame of empty screen, nothing more.
  }
}

export interface AccountStore {
  /** True when the host can manage accounts at all. Gate every account control on this. */
  canManageAccounts: Accessor<boolean>;
  accounts: Accessor<Account[]>;
  /**
   * The account this app instance is running against.
   *
   * Correct at first paint, not merely once the host has answered: the list is seeded from a
   * synchronous cache. See the cache notes at the top of this file.
   */
  activeAccount: Accessor<Account | undefined>;
  /** True when there is somewhere else to switch to. */
  hasOtherAccounts: Accessor<boolean>;
  /** True while a mutation is in flight — note that a successful one ends in a relaunch. */
  busy: Accessor<boolean>;
  /**
   * The account being switched to, from the click until the process goes away.
   *
   * Exists so the boot screen can show the target's badge immediately rather than the account
   * being left behind. Switching tears the renderer down and rebuilds it, so without this the
   * screen shows the old identity, then blanks, then shows the new one.
   */
  switchingTo: Accessor<Account | null>;
  /** True from the moment a create is requested until the process goes away. */
  creating: Accessor<boolean>;
  error: Accessor<string>;

  refresh: () => Promise<void>;
  /** Create an account and relaunch into it. The setup screen names it. Does not return on success. */
  createAccount: () => Promise<void>;
  /**
   * Mirror the profile onto the account this app is running as — the name shown on the sign-in
   * screen, and a cached copy of the picture the locked screen cannot otherwise read.
   *
   * Resolves without doing anything when the host manages no accounts (web) or nothing changed,
   * so callers need no platform branch. Never throws: an account label failing to update must not
   * take down the profile edit that triggered it.
   */
  syncDisplay: (display: { name?: string; avatar?: string }) => Promise<void>;
  /** Switch and relaunch. Does not return on success. */
  switchAccount: (id: string) => Promise<void>;
  /**
   * The account a removal has been requested for, awaiting confirmation. Null when none is.
   *
   * Held here rather than in schema local state because the request originates inside an `$each`
   * over the account list, where per-row local state does not exist — and because what needs
   * confirming is a whole account, not an id the dialog would then have to look up again.
   */
  pendingRemoval: Accessor<Account | null>;
  /** Delete an account outright. `confirmRemoval` is the confirmed path the UI uses. */
  removeAccount: (id: string) => Promise<void>;
  requestRemoval: (id: string) => void;
  cancelRemoval: () => void;
  /** Delete the account awaiting confirmation, along with its data. */
  confirmRemoval: () => Promise<void>;
  clearError: () => void;
}

const AccountContext = createContext<AccountStore>();

export function AccountStoreProvider(props: ParentProps) {
  const platform = usePlatform();

  // Seeded synchronously, before the first paint — see the cache notes above.
  const [accounts, setAccounts] = createSignal<Account[]>(readCachedAccounts());
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [pendingRemovalId, setPendingRemovalId] = createSignal<string | null>(null);
  // Held as the account itself, NOT derived from `accounts()`. A memo over the list evaporates
  // the moment the list is empty or reloading — which is exactly what happens mid-switch — and
  // the boot screen would fall through to a state that infers "no target, so this is a create".
  const [switchingTo, setSwitchingTo] = createSignal<Account | null>(null);
  const [creating, setCreating] = createSignal(false);
  // Read once, synchronously, at construction — before the first paint.

  const host = () => platform.accounts;
  const canManageAccounts = createMemo(() => !!host());
  const activeAccount = createMemo(() => accounts().find((a) => a.active));
  // Derived from the list rather than stored, so a request cannot outlive the account it names —
  // a refresh that drops it (removed in another window, say) closes the dialog by itself.
  const pendingRemoval = createMemo(() => accounts().find((a) => a.id === pendingRemovalId()) ?? null);
  const hasOtherAccounts = createMemo(() => accounts().length > 1);

  async function refresh(): Promise<void> {
    const accountHost = host();
    if (!accountHost) return;
    try {
      const loaded = await accountHost.list();
      setAccounts(loaded);
      // Keep the cache current, so the next boot draws immediately — including after a profile
      // edit, which changes the name and picture this holds.
      writeCachedAccounts(loaded);
    } catch (err) {
      console.error('AccountStore: could not list accounts', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Mutate, then hand over to the host to make it take effect.
   *
   * On success this does not return — the JS context is torn down, by a window reload or an app
   * relaunch depending on the host. So `busy` is only ever cleared on failure, which is correct:
   * leaving the spinner up while that happens reads as "working", and clearing it first would
   * flash the button back to idle mid-teardown.
   */
  /**
   * Returns false when the operation failed, and does not return at all when it succeeded — the
   * process is gone by then. Callers need the distinction because they apply the outcome to the
   * list *optimistically*, before the host has confirmed it, and a failure has to be undone.
   */
  async function mutateAndRestart<T>(action: () => Promise<T>, beforeRestart?: (result: T) => void): Promise<boolean> {
    const accountHost = host();
    if (!accountHost) return false;

    setBusy(true);
    setError('');
    try {
      const result = await action();
      beforeRestart?.(result);
      await accountHost.applySelection();
      return true;
    } catch (err) {
      console.error('AccountStore: account operation failed', err);
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
      return false;
    }
  }

  async function createAccount(): Promise<void> {
    setCreating(true);
    // Cache the created account before the restart, or the reload would draw the account being
    // left behind until the list catches up.
    const ok = await mutateAndRestart(
      () => host()!.create(),
      // The created account is the active one from here; everything else steps down. Applied to
      // the live list as well as the cache, so the corner drops it the moment it exists.
      (account) => {
        const optimistic = [...accounts().map((a) => ({ ...a, active: false })), account];
        setAccounts(optimistic);
        writeCachedAccounts(optimistic);
      },
    );
    // Only reached when it failed — on success the process is already gone.
    setCreating(false);
    if (!ok) await refresh();
  }

  async function syncDisplay(display: { name?: string; avatar?: string }): Promise<void> {
    const accountHost = host();
    const active = activeAccount();
    if (!accountHost || !active) return;

    const name = display.name?.trim();
    const changedName = name && name !== active.name ? name : undefined;
    const changedAvatar = display.avatar && display.avatar !== active.avatar ? display.avatar : undefined;
    if (!changedName && !changedAvatar) return;

    try {
      await accountHost.setDisplay(active.id, {
        ...(changedName ? { name: changedName } : {}),
        ...(changedAvatar ? { avatar: changedAvatar } : {}),
      });
      await refresh();
    } catch (err) {
      // Logged, not surfaced and not rethrown. This runs as a side effect of publishing a profile;
      // a stale label on the sign-in screen is a cosmetic problem, and letting it fail the profile
      // write — or the account creation chained behind it — would trade a real thing for a label.
      console.error('AccountStore: could not update the account display', err);
    }
  }

  async function switchAccount(id: string): Promise<void> {
    const target = accounts().find((a) => a.id === id);
    if (!target || target.active) return;
    // Set before the await so the boot screen swaps to the target's badge on the click rather
    // than a beat later.
    setSwitchingTo(target);
    // Move the active flag now rather than waiting for the switch to land. The screen is a
    // function of this list: the centre badge is whichever account is active and the corner is
    // everyone else, so without this the target sits in both places at once until the restart.
    //
    // The same list is cached, because the restart happens before any refresh could run — the
    // next document would otherwise draw the account just left as current.
    const optimistic = accounts().map((a) => ({ ...a, active: a.id === id }));
    setAccounts(optimistic);
    writeCachedAccounts(optimistic);

    const ok = await mutateAndRestart(() => host()!.select(id));

    // Only reached when the switch failed — on success the process is already gone. Put the truth
    // back, since the flag above was moved on the assumption it would succeed.
    if (!ok) {
      setSwitchingTo(null);
      await refresh();
    }
  }

  function requestRemoval(id: string): void {
    setError('');
    setPendingRemovalId(id);
  }

  function cancelRemoval(): void {
    setPendingRemovalId(null);
  }

  async function confirmRemoval(): Promise<void> {
    const target = pendingRemoval();
    if (!target) return;
    await removeAccount(target.id);
    // Closed regardless of outcome: on success there is nothing left to confirm, and on failure
    // the error is rendered on the settings page behind it rather than inside the dialog.
    setPendingRemovalId(null);
  }

  /** Removal does not restart — the account being removed is by definition not the running one. */
  async function removeAccount(id: string): Promise<void> {
    const accountHost = host();
    if (!accountHost) return;

    setBusy(true);
    setError('');
    try {
      await accountHost.remove(id);
      await refresh();
    } catch (err) {
      console.error('AccountStore: could not remove account', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  // Loaded once on mount rather than lazily: the boot screen reads it immediately, and it is a
  // filesystem read in the host process rather than a network round trip.
  onMount(() => void refresh());

  const store: AccountStore = {
    canManageAccounts,
    accounts,
    activeAccount,
    hasOtherAccounts,
    busy,
    switchingTo,
    creating,
    error,
    pendingRemoval,
    refresh,
    createAccount,
    syncDisplay,
    switchAccount,
    removeAccount,
    requestRemoval,
    cancelRemoval,
    confirmRemoval,
    clearError: () => setError(''),
  };

  return <AccountContext.Provider value={store}>{props.children}</AccountContext.Provider>;
}

export function useAccountStore(): AccountStore {
  const context = useContext(AccountContext);
  if (!context) throw new Error('useAccountStore must be used within the AccountStoreProvider');
  return context;
}
