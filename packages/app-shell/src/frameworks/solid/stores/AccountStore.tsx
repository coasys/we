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

export interface AccountStore {
  /** True when the host can manage accounts at all. Gate every account control on this. */
  canManageAccounts: Accessor<boolean>;
  accounts: Accessor<Account[]>;
  /** The account this app instance is running against, once the list has loaded. */
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

  const [accounts, setAccounts] = createSignal<Account[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [pendingRemovalId, setPendingRemovalId] = createSignal<string | null>(null);
  // Held as the account itself, NOT derived from `accounts()`. A memo over the list evaporates
  // the moment the list is empty or reloading — which is exactly what happens mid-switch — and
  // the boot screen would fall through to a state that infers "no target, so this is a create".
  const [switchingTo, setSwitchingTo] = createSignal<Account | null>(null);
  const [creating, setCreating] = createSignal(false);

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
      setAccounts(await accountHost.list());
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
  async function mutateAndRestart(action: () => Promise<unknown>): Promise<void> {
    const accountHost = host();
    if (!accountHost) return;

    setBusy(true);
    setError('');
    try {
      await action();
      await accountHost.applySelection();
    } catch (err) {
      console.error('AccountStore: account operation failed', err);
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function createAccount(): Promise<void> {
    setCreating(true);
    await mutateAndRestart(() => host()!.create());
    // Only reached when it failed — on success the process is already gone.
    setCreating(false);
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
    await mutateAndRestart(() => host()!.select(id));
    // Only reached when the switch failed — on success the process is already gone.
    setSwitchingTo(null);
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
