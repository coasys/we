/**
 * The Identity module — your DID, devices, guardians, recovery, and event log.
 *
 * Agent-scoped: registered once per person, not tied to any space.
 *
 * ## Where UI lives
 *
 * The Settings account page (`IdentitySettings.schema.ts` in the shell template) renders the
 * identity UI. It reads store signals via `$: 'modules.identity.<field>'` — no cross-package
 * import, just runtime store-path resolution.
 *
 * ## Where state lives
 *
 * - **Identity data** — signals on the store (`identity`, `roster`, `guardians`, `kelEvents`,
 *   `recoveryState`), populated by the host's wiring to the identity RPC client after auth.
 * - **Tab / detail selection** — `$localState` in the Settings schema, local to the component.
 *
 * ## Data flow
 *
 * The store exposes data signals (starting empty/null) and setters. The host wiring
 * (`wireIdentityModule` in the app-shell) fetches from the executor's identity RPC handlers,
 * transforms the responses, and pushes them into the setters. Action stubs (`revokeKey`,
 * `exportKel`, etc.) get replaced with real RPC-backed implementations by the same wiring.
 */
import { defineModule, type ModuleStoreDeps } from '@we/module-shared';

// ─── Module definition ───────────────────────────────────────────────────────

export const identityModule = defineModule({
  id: 'identity',
  name: 'Identity',
  description: 'Your DID, enrolled devices, guardians, recovery, and event log.',
  icon: 'fingerprint',

  /**
   * Agent-scoped — identity data belongs to the person, not a community.
   *
   * The store provides identity data to the Settings account page. No launcher, no dock —
   * the UI lives in the shell's Settings template, referencing `modules.identity.*` signals.
   */
  scope: 'agent',

  createStore: ({ signal }: ModuleStoreDeps) => {
    type R = Record<string, unknown>;

    // ── Identity data ──
    // Populated by the host's wiring to the identity client when it connects.
    // Each starts empty; the schema fragments handle the loading state via $if guards.

    /** The resolved identity — DID, display name, agent type. */
    const [identity, setIdentity] = signal<R | null>(null);
    /** All enrolled devices, executors, and assistants. */
    const [roster, setRoster] = signal<R[]>([]);
    /** Guardian entries with consent status. */
    const [guardians, setGuardians] = signal<R[]>([]);
    /** KEL event log. */
    const [kelEvents, setKelEvents] = signal<R[]>([]);
    /** Active recovery request state, or null when no recovery runs. */
    const [recoveryState, setRecoveryState] = signal<R | null>(null);
    /** Whether the mnemonic backup has been confirmed. */
    const [backupConfirmed, setBackupConfirmed] = signal(false);
    /** Incoming recovery requests from people this agent guards. */
    const [incomingRecoveryRequests, setIncomingRecoveryRequests] = signal<R[]>([]);

    /** The currently selected device for the detail view, or null. */
    const [selectedDeviceId, setSelectedDeviceId] = signal<string | null>(null);

    return {
      // ── Identity data (read by schema fragments) ──
      identity,
      roster,
      guardians,
      kelEvents,
      recoveryState,
      backupConfirmed,
      incomingRecoveryRequests,

      // ── Derived values ──
      /** Roster entries of type 'device' or 'executor'. */
      devices: () => roster().filter((e: R) => e.type !== 'assistant'),
      /** Roster entries of type 'assistant'. */
      assistants: () => roster().filter((e: R) => e.type === 'assistant'),
      /** Count labels for section headers. */
      deviceCount: () => `${roster().filter((e: R) => e.type !== 'assistant').length}`,
      assistantCount: () => `${roster().filter((e: R) => e.type === 'assistant').length}`,
      guardianCount: () => `${guardians().length}`,

      /** Whether any guardian has not yet consented. */
      pendingGuardians: () => guardians().some((g: R) => !g.consented),

      /** Threshold label like "2/3". */
      thresholdLabel: () => {
        const gs = guardians();
        if (!gs.length) return '';
        const threshold = (identity() as Record<string, unknown> | null)?.recoveryThreshold;
        return `${threshold ?? '?'}/${gs.length}`;
      },
      /** Threshold description like "2 of 3 guardians needed to recover". */
      thresholdDescription: () => {
        const gs = guardians();
        const threshold = (identity() as Record<string, unknown> | null)?.recoveryThreshold;
        return `${threshold ?? '?'} of ${gs.length} guardians needed to recover`;
      },
      /** Guardian recovery button label. */
      guardianRecoveryLabel: () => {
        const gs = guardians();
        const threshold = (identity() as Record<string, unknown> | null)?.recoveryThreshold;
        return `Ask ${threshold ?? '?'} of your ${gs.length} guardians to approve recovery`;
      },

      /** The full detail of the currently selected device. */
      selectedDevice: () => {
        const id = selectedDeviceId();
        if (!id) return null;
        return roster().find((e: R) => e.id === id) ?? null;
      },

      // ── Device selection ──
      selectedDeviceId,
      selectDevice: (id: unknown) => setSelectedDeviceId(id as string),
      clearSelection: () => setSelectedDeviceId(null),

      // ── Actions ──
      /** Copy the DID to clipboard. */
      copyDid: () => {
        const id = identity();
        const did = id ? (id as Record<string, unknown>).did : null;
        if (did && typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(did as string).catch(() => {
            /* clipboard unavailable — silent */
          });
        }
      },

      // ── Actions — wired by the host's identity client integration ──
      // The host replaces these stubs with real RPC-backed implementations after auth.
      // Until then they degrade gracefully — a click does nothing visible.
      revokeKey: (_keyId: unknown) => {
        /* Wired by the host — revokes a key and refreshes the roster. */
      },
      exportKel: () => {
        /* Wired by the host — downloads KEL as JSON file. */
      },
      startMnemonicRecovery: () => {
        /* Wired by the host — opens the mnemonic recovery ceremony. */
      },
      startGuardianRecovery: () => {
        /* Wired by the host — opens the guardian recovery ceremony. */
      },
      vetoRecovery: () => {
        /* Wired by the host — vetoes the active recovery request. */
      },
      approveRecovery: (_requestId: unknown) => {
        /* Wired by the host — approves an incoming recovery request. */
      },
      startBackup: () => {
        /* Wired by the host — begins the mnemonic backup ceremony. */
      },
      startEnrolment: () => {
        /* Wired by the host — creates an enrolment offer for a new device or assistant. */
      },
      addGuardian: () => {
        /* Wired by the host — begins the guardian addition flow. */
      },

      // ── Data setters (called by the host's identity client wiring) ──
      setIdentity,
      setRoster,
      setGuardians,
      setKelEvents,
      setRecoveryState,
      setBackupConfirmed,
      setIncomingRecoveryRequests,
    };
  },
});
