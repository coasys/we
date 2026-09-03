/**
 * Host-side wiring for the identity module.
 *
 * Fetches identity data from the executor's identity RPC handlers, transforms the responses
 * into the shapes the Settings UI expects, and pushes them into the module's reactive store.
 * Also wires the stub actions (export, revoke, backup, enrolment) to real RPC calls.
 *
 * Called from BootController after auth, when the connection details and agent DID are available.
 * The identity module's store already exists at that point — it was created synchronously during
 * module registration in PlatformProvider.
 */
import { moduleStores } from '../registries/moduleRegistry';
import { identityRpc, type IdentityRpcConfig } from './identityRpc';

// ─── Response types (executor shapes) ──────────────────────────────────────

interface ResolvedIdentity {
  did: string;
  validity: string;
  keyState?: {
    headSeq: number;
    agentType: string;
    validKeys: Array<{
      id: string;
      signingKey: string;
      encryptionKey: string | null;
      scope: { sign: boolean; kelOps: boolean; delegate: boolean };
    }>;
  };
}

interface RosterEntry {
  key: {
    id: string;
    signingKey: string;
    encryptionKey: string | null;
    scope: { sign: boolean; kelOps: boolean; delegate: boolean };
  };
  label: string | null;
  lane: string | null;
  enrolledAtSeq: number;
  active: boolean;
  revokedAtSeq: number | null;
}

interface KelEvent {
  seq: number;
  type: string;
  summary: string;
  signedBy: string;
  raw: string;
}

// ─── Transformers ──────────────────────────────────────────────────────────

/** Map the Rust Lane enum's debug string to a UI type and icon. */
function laneToUi(lane: string | null): { type: string; icon: string } {
  switch (lane) {
    case 'LocalDevice':
      return { type: 'device', icon: 'desktop' };
    case 'MobileDevice':
      return { type: 'device', icon: 'device-mobile' };
    case 'RemoteDevice':
      return { type: 'device', icon: 'cloud' };
    case 'Assistant':
      return { type: 'assistant', icon: 'robot' };
    default:
      return { type: 'device', icon: 'desktop' };
  }
}

/** Format a scope object into a human-readable summary. */
function formatScope(scope: { sign?: boolean; kelOps?: boolean; delegate?: boolean }): string {
  const parts: string[] = [];
  if (scope.sign) parts.push('sign');
  if (scope.kelOps) parts.push('KEL ops');
  if (scope.delegate) parts.push('delegate');
  return parts.length ? parts.join(', ') : 'No permissions';
}

/** Convert scope flags to an array of labels for tag display. */
function scopeToArray(scope: { sign?: boolean; kelOps?: boolean; delegate?: boolean }): string[] {
  const out: string[] = [];
  if (scope.sign) out.push('sign');
  if (scope.kelOps) out.push('KEL ops');
  if (scope.delegate) out.push('delegate');
  return out;
}

/** Transform a raw roster entry from the executor into the shape the UI reads. */
function transformRosterEntry(raw: RosterEntry): Record<string, unknown> {
  const lane = laneToUi(raw.lane);
  const scope = raw.key?.scope ?? { sign: false, kelOps: false, delegate: false };

  return {
    id: raw.key?.id ?? '',
    label: raw.label ?? raw.key?.id?.substring(0, 16) ?? 'Unknown device',
    icon: lane.icon,
    type: lane.type,
    scopeSummary: formatScope(scope),
    active: raw.active ?? false,
    keyId: raw.key?.id ?? '',
    signingKey: raw.key?.signingKey ?? '',
    delegatedAt: `Sequence #${raw.enrolledAtSeq ?? '?'}`,
    scopes: scopeToArray(scope),
    encryptionKey: raw.key?.encryptionKey ?? null,
  };
}

/** Transform a raw KEL event into the shape the UI reads. */
function transformKelEvent(raw: KelEvent): Record<string, unknown> {
  return {
    seqLabel: `#${raw.seq ?? '?'}`,
    type: raw.type ?? 'unknown',
    summary: raw.summary ?? '',
  };
}

// ─── Wiring ────────────────────────────────────────────────────────────────

/**
 * Connect the identity module's store to the executor's identity RPC handlers.
 *
 * Fetches all identity data, transforms it, and pushes it into the module's signals.
 * Replaces the stub actions with real RPC-backed implementations.
 *
 * Returns a cleanup function (currently a no-op — kept for future subscription teardown).
 */
export async function wireIdentityModule(config: IdentityRpcConfig, agentDid: string): Promise<() => void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const store = (moduleStores as Record<string, any>).identity;
  if (!store) {
    console.warn('wireIdentityModule: identity module not registered, skipping');
    return () => {};
  }

  // ── Fetch and populate data ──
  // Each call is independent — one failing should not block the others.

  // Identity (resolve)
  try {
    const resolved = await identityRpc<ResolvedIdentity>(config, 'identity.resolve', { id: agentDid });
    store.setIdentity({
      did: resolved.did ?? agentDid,
      name: resolved.did ? `${resolved.did.substring(0, 24)}…` : agentDid,
      agentType: resolved.keyState?.agentType ?? 'human',
    });
  } catch (err) {
    console.warn('wireIdentityModule: identity.resolve failed, setting fallback', err);
    store.setIdentity({
      did: agentDid,
      name: `${agentDid.substring(0, 24)}…`,
      agentType: 'human',
    });
  }

  // Roster
  try {
    const roster = await identityRpc<RosterEntry[]>(config, 'identity.roster', { did: agentDid });
    store.setRoster((roster ?? []).map(transformRosterEntry));
  } catch (err) {
    console.warn('wireIdentityModule: identity.roster failed', err);
    store.setRoster([]);
  }

  // KEL events
  try {
    const events = await identityRpc<KelEvent[]>(config, 'identity.kelEvents', { did: agentDid });
    store.setKelEvents((events ?? []).map(transformKelEvent));
  } catch (err) {
    console.warn('wireIdentityModule: identity.kelEvents failed', err);
    store.setKelEvents([]);
  }

  // Guardians (currently returns [] from executor)
  try {
    const guardians = await identityRpc<unknown[]>(config, 'identity.guardians', { did: agentDid });
    store.setGuardians(guardians ?? []);
  } catch (err) {
    console.warn('wireIdentityModule: identity.guardians failed', err);
    store.setGuardians([]);
  }

  // Recovery state (currently returns null from executor)
  try {
    const state = await identityRpc<unknown>(config, 'identity.recoveryState', { did: agentDid });
    store.setRecoveryState(state ?? null);
  } catch (err) {
    console.warn('wireIdentityModule: identity.recoveryState failed', err);
    store.setRecoveryState(null);
  }

  // ── Wire actions ──

  /** Helper: refetch the roster and update the store. */
  async function refreshRoster(): Promise<void> {
    try {
      const roster = await identityRpc<RosterEntry[]>(config, 'identity.roster', { did: agentDid });
      store.setRoster((roster ?? []).map(transformRosterEntry));
    } catch {
      /* keep current state on refresh failure */
    }
  }

  store.exportKel = async () => {
    try {
      const kel = await identityRpc<string>(config, 'identity.exportKel', { did: agentDid });
      const text = typeof kel === 'string' ? kel : JSON.stringify(kel, null, 2);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kel-export-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('wireIdentityModule: exportKel failed', err);
    }
  };

  store.revokeKey = async (keyId: unknown) => {
    try {
      await identityRpc(config, 'identity.revokeKey', { did: agentDid, keyId: keyId as string });
      await refreshRoster();
    } catch (err) {
      console.error('wireIdentityModule: revokeKey failed', err);
    }
  };

  store.startBackup = async () => {
    try {
      const mnemonic = await identityRpc<string>(config, 'identity.generateMnemonic');
      // For now, show the mnemonic in an alert. A proper backup ceremony UI comes later.
      if (typeof mnemonic === 'string' && mnemonic.length > 0) {
        window.alert(`Recovery phrase (write this down securely):\n\n${mnemonic}`);
        await identityRpc<boolean>(config, 'identity.confirmMnemonicBackup');
        store.setBackupConfirmed(true);
      }
    } catch (err) {
      console.error('wireIdentityModule: startBackup failed', err);
    }
  };

  store.startEnrolment = async () => {
    try {
      const offer = await identityRpc<{ publicKey: string; label: string; challenge: string }>(
        config,
        'identity.createEnrolOffer',
        { label: `Device ${Date.now()}` },
      );
      // Show the enrolment offer. A proper QR code / share UI comes later.

      window.alert(`Enrolment offer created:\n\nPublic key: ${offer.publicKey}\nChallenge: ${offer.challenge}`);
      await refreshRoster();
    } catch (err) {
      console.error('wireIdentityModule: startEnrolment failed', err);
    }
  };

  // Actions that require wallet signing — not yet implemented in the executor.
  store.startMnemonicRecovery = () => {
    console.warn('Mnemonic recovery requires wallet signing — not yet available.');
  };
  store.startGuardianRecovery = () => {
    console.warn('Guardian recovery requires wallet signing — not yet available.');
  };
  store.vetoRecovery = () => {
    console.warn('Veto recovery requires wallet signing — not yet available.');
  };
  store.approveRecovery = (_requestId: unknown) => {
    console.warn('Approve recovery requires wallet signing — not yet available.');
  };
  store.addGuardian = () => {
    console.warn('Adding guardians requires wallet signing — not yet available.');
  };

  console.info('wireIdentityModule: identity module wired successfully');
  return () => {
    /* Future: tear down subscriptions */
  };
}
