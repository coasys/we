/**
 * AccountStore — which local accounts exist, and switching between them.
 *
 * The Solid binding over `PlatformAdapter.accounts`. Unusually for a store, it reads nothing from
 * the backend: an account is a directory on disk, and the list of them is knowable before any
 * executor is running. That is the point — the boot screen needs it while the session is still
 * locked, which is exactly when no backend question can be answered.
 *
 * Every mutation ends in a restart. The executor is configured with one data path at startup and
 * holds it for its lifetime, so "switch account" cannot mean anything else; the ADAM launcher
 * quits the app for the same reason. Creating an account deliberately does not create an agent —
 * it makes an empty directory and restarts into it, where the create-agent boot state takes over
 * and the user chooses a passphrase. One first-run flow, not two.
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
  error: Accessor<string>;

  refresh: () => Promise<void>;
  /** Create an account and relaunch into it. Does not return on success. */
  createAccount: (name: string) => Promise<void>;
  /** Switch and relaunch. Does not return on success. */
  switchAccount: (id: string) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  clearError: () => void;
}

const AccountContext = createContext<AccountStore>();

export function AccountStoreProvider(props: ParentProps) {
  const platform = usePlatform();

  const [accounts, setAccounts] = createSignal<Account[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');

  const host = () => platform.accounts;
  const canManageAccounts = createMemo(() => !!host());
  const activeAccount = createMemo(() => accounts().find((a) => a.active));
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
   * Mutate, then relaunch.
   *
   * On success this does not return — the host tears the process down. So `busy` is only ever
   * cleared on failure, which is correct: leaving the spinner up while the window closes reads as
   * "working", and clearing it first would flash the button back to idle mid-teardown.
   */
  async function mutateAndRestart(action: () => Promise<unknown>): Promise<void> {
    const accountHost = host();
    if (!accountHost) return;

    setBusy(true);
    setError('');
    try {
      await action();
      await accountHost.restart();
    } catch (err) {
      console.error('AccountStore: account operation failed', err);
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  async function createAccount(name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('An account name is required');
      return;
    }
    await mutateAndRestart(() => host()!.create(trimmed));
  }

  async function switchAccount(id: string): Promise<void> {
    if (id === activeAccount()?.id) return;
    await mutateAndRestart(() => host()!.select(id));
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
    error,
    refresh,
    createAccount,
    switchAccount,
    removeAccount,
    clearError: () => setError(''),
  };

  return <AccountContext.Provider value={store}>{props.children}</AccountContext.Provider>;
}

export function useAccountStore(): AccountStore {
  const context = useContext(AccountContext);
  if (!context) throw new Error('useAccountStore must be used within the AccountStoreProvider');
  return context;
}
