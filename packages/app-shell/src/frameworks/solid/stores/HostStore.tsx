/**
 * HostStore — a host as a place the person's identity lives, in its two roles.
 *
 * **As a tenant**: the person's own session on a host (Coasys cloud, or one they name): what they use
 * there (`usage`), leaving it keeping their data or deleting it, saving everything to a file, and
 * loading such a file. The session is opened by the backend on the first call and signed with the
 * person's own identity; its token stays in the backend's memory and never reaches this store or any
 * storage. A host that holds the tenant answers every other call `not-admitted`: the store then shows
 * the held state, which allows reading, exporting, usage and leaving only.
 *
 * **As the operator**: the host this computer runs: who may join (Sign-ups), the invites sent, and the
 * people on it.
 *
 * Chrome tier only (`devices` in `templateSurface.ts`).
 */
import {
  type HostPolicyView,
  type HostSignup,
  isNotAdmitted,
  type TenantHostPort,
  type TenantUsageView,
} from '@we/backend-shared';
import { saveFile } from '@we/design-utils';
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

import {
  CHOICE_NEEDED,
  type InviteRow,
  inviteRows,
  isHeld,
  type PersonRow,
  personRows,
  SIGNUP_OPTIONS,
  type UsageLines,
  usageLines,
} from '../../../shared/hostRows';
import { pickFile } from '../../../shared/pickFile';
import { useIdentityStore } from './IdentityStore';
import { useSessionStore } from './SessionStore';

/** How long an invite lasts. */
const INVITE_DAYS = 7;

export interface HostStore {
  // ─── As a tenant ──────────────────────────────────────────────────────────────
  /** The person's host can be looked at from here: this computer can sign in to one as them. */
  canViewHost: Accessor<boolean>;
  /** The host is Coasys cloud, so its welcome text is shown. */
  isCoasysCloud: Accessor<boolean>;
  usage: Accessor<UsageLines | null>;
  /** The host holds this tenant: only reading, exporting, usage and leaving work. */
  held: Accessor<boolean>;
  /** Why the last call to the host failed, or empty. */
  error: Accessor<string>;
  /** What the last export, import or leave did, or empty. */
  notice: Accessor<string>;
  busy: Accessor<boolean>;
  /** Looks at the host at `address`, or at Coasys cloud when it is empty. */
  openHost: (address?: string) => Promise<void>;
  /**
   * Leaves the host. `exportFirst` saves everything to a file first and leaves only once it is saved.
   * `keepData` false destroys the data on the host at once.
   */
  leave: (keepData: boolean, exportFirst: boolean) => Promise<boolean>;
  /** Saves everything the host keeps for the person to a gzip file. */
  exportData: () => Promise<boolean>;
  /** Loads a file made by `exportData` into new private spaces. */
  importData: () => Promise<boolean>;

  // ─── As the operator ──────────────────────────────────────────────────────────
  /** This computer runs a host that takes people: Sign-ups and People can be offered. */
  canOperate: Accessor<boolean>;
  policy: Accessor<HostPolicyView | null>;
  /** The operator has never chosen who may join. */
  choiceNeeded: Accessor<boolean>;
  choiceNeededText: string;
  signupOptions: { value: HostSignup; label: string }[];
  invites: Accessor<InviteRow[]>;
  people: Accessor<PersonRow[]>;
  /** The secret of the invite just made, shown once. */
  newInvite: Accessor<string>;
  operatorError: Accessor<string>;
  operatorBusy: Accessor<boolean>;
  setSignup: (signup: HostSignup) => Promise<void>;
  createInvite: (note: string) => Promise<void>;
  revokeInvite: (id: string) => Promise<void>;
  removePerson: (id: string) => Promise<void>;
}

const HostStoreContext = createContext<HostStore>();

const hostName = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

export function HostStoreProvider(props: ParentProps) {
  const session = useSessionStore();
  const identity = useIdentityStore();
  const port = () => session.backendPorts()?.hosts ?? null;

  const [address, setAddress] = createSignal('');
  const [usage, setUsage] = createSignal<TenantUsageView | null>(null);
  const [held, setHeld] = createSignal(false);
  const [error, setError] = createSignal('');
  const [notice, setNotice] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  const [policy, setPolicy] = createSignal<HostPolicyView | null>(null);
  const [operatorUp, setOperatorUp] = createSignal(false);
  const [invites, setInvites] = createSignal<InviteRow[]>([]);
  const [people, setPeople] = createSignal<PersonRow[]>([]);
  const [newInvite, setNewInvite] = createSignal('');
  const [operatorError, setOperatorError] = createSignal('');
  const [operatorBusy, setOperatorBusy] = createSignal(false);

  const coasysUrl = () => identity.custody()?.cloudUrl ?? '';
  const hostUrl = createMemo(() => address() || coasysUrl());

  // One tenant session at a time: the host being looked at. A different host, or a different backend,
  // ends the session of the one before.
  let open: { port: ReturnType<typeof port>; url: string; tenant: TenantHostPort } | null = null;
  function tenant(): TenantHostPort | null {
    const hosts = port();
    const url = hostUrl();
    if (!hosts || !url) return null;
    if (open && open.port === hosts && open.url === url) return open.tenant;
    open?.tenant.close();
    open = { port: hosts, url, tenant: hosts.tenant(url) };
    return open.tenant;
  }
  function closeHost(): void {
    open?.tenant.close();
    open = null;
  }

  function reset(): void {
    closeHost();
    setAddress('');
    setUsage(null);
    setHeld(false);
    setError('');
    setNotice('');
    setPolicy(null);
    setOperatorUp(false);
    setInvites([]);
    setPeople([]);
    setNewInvite('');
    setOperatorError('');
  }
  // Reading what this computer's own host says costs nothing and signs nothing, so it is read as soon
  // as there is a backend. A tenant's session is opened only when the person asks (`openHost`).
  createEffect(
    on(port, () => {
      reset();
      if (port()) void loadOperator();
    }),
  );

  /** Runs a call on the host, saying why it failed in words and treating a refusal as the held state. */
  async function onHost<T>(run: (t: TenantHostPort) => Promise<T>): Promise<T | undefined> {
    const t = tenant();
    if (!t) return undefined;
    setBusy(true);
    setError('');
    try {
      return await run(t);
    } catch (e) {
      if (isNotAdmitted(e)) setHeld(true);
      else setError(`Can't reach ${hostName(hostUrl())}. Try again.`);
      console.warn('HostStore: the host did not answer', e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function refreshUsage(): Promise<void> {
    const read = await onHost((t) => t.usage());
    if (!read) return;
    setUsage(read);
    setHeld(isHeld(read));
  }

  async function openHost(typed?: string): Promise<void> {
    setAddress(typed?.trim() ?? '');
    setNotice('');
    setUsage(null);
    setHeld(false);
    await refreshUsage();
  }

  /** Saves the export to a file; true once the person has it. */
  async function exportData(): Promise<boolean> {
    setNotice('');
    const t = tenant();
    if (!t) return false;
    const name = `${hostName(hostUrl())}-export.json.gz`;
    setBusy(true);
    setError('');
    try {
      // The file is made after the save dialog opens: a browser lets a dialog open only from a click.
      const outcome = await saveFile({
        name,
        type: 'application/gzip',
        content: async () => new Blob([new Uint8Array(await t.exportFile())], { type: 'application/gzip' }),
      });
      if (outcome === 'cancelled' || outcome === 'empty') return false;
      setNotice('Export saved');
      return true;
    } catch (e) {
      if (isNotAdmitted(e)) setHeld(true);
      else setError(`Can't export from ${hostName(hostUrl())}. Try again.`);
      console.warn('HostStore: export failed', e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function importData(): Promise<boolean> {
    setNotice('');
    const file = await pickFile('.gz,application/gzip');
    if (!file) return false;
    const result = await onHost(async (t) => t.importFile(new Uint8Array(await file.arrayBuffer())));
    if (!result) return false;
    setNotice(
      result.linksInvalid > 0
        ? `Imported ${result.linksWritten} items. ${result.linksInvalid} did not pass the signature check.`
        : `Imported ${result.linksWritten} items`,
    );
    await refreshUsage();
    return true;
  }

  async function leave(keepData: boolean, exportFirst: boolean): Promise<boolean> {
    setNotice('');
    if (exportFirst && !(await exportData())) return false;
    const url = hostUrl();
    const left = await onHost((t) => t.leave(keepData));
    if (!left) return false;
    setUsage(null);
    setHeld(false);
    setNotice(
      keepData
        ? `You left ${hostName(url)}. Your data stays there.`
        : `You left ${hostName(url)}. Your data is deleted.`,
    );
    return true;
  }

  // ─── Operator ───────────────────────────────────────────────────────────────

  async function operate(
    run: (hosts: NonNullable<ReturnType<typeof port>>['operator']) => Promise<void>,
  ): Promise<void> {
    const hosts = port();
    if (!hosts) return;
    setOperatorBusy(true);
    setOperatorError('');
    try {
      await run(hosts.operator);
    } catch (e) {
      console.warn('HostStore: the host call failed', e);
      setOperatorError('That did not work. Try again.');
    } finally {
      setOperatorBusy(false);
    }
  }

  const readOperator = async (op: NonNullable<ReturnType<typeof port>>['operator']) => {
    const [nextPolicy, nextInvites, nextPeople] = await Promise.all([op.policy(), op.listInvites(), op.tenants()]);
    setPolicy(nextPolicy);
    setInvites(inviteRows(nextInvites, Date.now() / 1000));
    setPeople(personRows(nextPeople));
  };

  async function loadOperator(): Promise<void> {
    const hosts = port();
    if (!hosts) return;
    setOperatorBusy(true);
    try {
      // An executor that takes one person only has nothing to set: its answer is "not multi-user".
      const info = await hosts.operator.info();
      setOperatorUp(info.multiUser);
      if (info.multiUser) await readOperator(hosts.operator);
    } catch (e) {
      console.warn('HostStore: could not read this host', e);
      setOperatorUp(false);
    } finally {
      setOperatorBusy(false);
    }
  }

  const store: HostStore = {
    canViewHost: () => !!port() && !!identity.did(),
    isCoasysCloud: () => !address() && !!coasysUrl(),
    usage: createMemo(() => {
      const u = usage();
      return u ? usageLines(u) : null;
    }),
    held,
    error,
    notice,
    busy,
    openHost,
    leave,
    exportData,
    importData,

    canOperate: operatorUp,
    policy,
    choiceNeeded: () => !!policy()?.choiceNeeded,
    choiceNeededText: CHOICE_NEEDED,
    signupOptions: SIGNUP_OPTIONS,
    invites,
    people,
    newInvite,
    operatorError,
    operatorBusy,
    setSignup: (signup) =>
      operate(async (op) => {
        setPolicy(await op.setPolicy({ signup, maxTenants: null, displayName: null }));
      }),
    createInvite: (note) =>
      operate(async (op) => {
        const created = await op.createInvite(INVITE_DAYS, note.trim() || undefined);
        setNewInvite(created.secret);
        await readOperator(op);
      }),
    revokeInvite: (id) =>
      operate(async (op) => {
        await op.revokeInvite(id);
        await readOperator(op);
      }),
    removePerson: (id) =>
      operate(async (op) => {
        await op.removeTenant(id);
        await readOperator(op);
      }),
  };

  return <HostStoreContext.Provider value={store}>{props.children}</HostStoreContext.Provider>;
}

export function useHostStore(): HostStore {
  const store = useContext(HostStoreContext);
  if (!store) throw new Error('useHostStore must be used within HostStoreProvider');
  return store;
}
