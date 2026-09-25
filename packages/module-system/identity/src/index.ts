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
import { defineModule, type ModuleDefinition, type ModuleHost, type ModuleStoreDeps } from '@we/module-shared';

// ─── Module definition ───────────────────────────────────────────────────────

export const identityModule: ModuleDefinition = defineModule({
  manifest: {
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
  },

  createStore: ({ signal, state, action }: ModuleStoreDeps) => {
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
    /** Active enrollment offer — holds { qrDataUrl, label, publicKey, challenge } or null. */
    const [enrolmentOffer, setEnrolmentOffer] = signal<R | null>(null);

    /** The currently selected device for the detail view, or null. */
    const [selectedDeviceId, setSelectedDeviceId] = signal<string | null>(null);

    const threshold = () => (identity() as R | null)?.recoveryThreshold ?? '?';
    /** A stub the host's identity wiring replaces after auth; until then a click does nothing. */
    const wiredByHost = (doc: string) => action((..._args: unknown[]) => {}, doc);

    return {
      // ── Identity data (read by the Settings template) ──
      identity: state(identity, 'The resolved identity: DID, display name, agent type.'),
      roster: state(roster, 'Every enrolled device, node and assistant.'),
      guardians: state(guardians, 'Guardian entries with their consent status.'),
      kelEvents: state(kelEvents, "The identity's key event log."),
      recoveryState: state(recoveryState, 'The active recovery request, or null.'),
      backupConfirmed: state(backupConfirmed, 'Whether the recovery phrase backup has been confirmed.'),
      incomingRecoveryRequests: state(incomingRecoveryRequests, 'Recovery requests from people this identity guards.'),
      enrolmentOffer: state(enrolmentOffer, 'The open enrolment offer: QR image, label, public key, challenge.'),

      // ── Derived values ──
      devices: state(() => roster().filter((e: R) => e.type !== 'assistant'), 'Roster entries for devices and nodes.'),
      assistants: state(() => roster().filter((e: R) => e.type === 'assistant'), 'Roster entries for assistants.'),
      deviceCount: state(
        () => `${roster().filter((e: R) => e.type !== 'assistant').length}`,
        'How many devices and nodes.',
      ),
      assistantCount: state(
        () => `${roster().filter((e: R) => e.type === 'assistant').length}`,
        'How many assistants.',
      ),
      guardianCount: state(() => `${guardians().length}`, 'How many guardians.'),
      pendingGuardians: state(
        () => guardians().some((g: R) => !g.consented),
        'Whether any guardian has yet to consent.',
      ),
      thresholdLabel: state(
        () => (guardians().length ? `${threshold()}/${guardians().length}` : ''),
        'The recovery threshold, like "2/3".',
      ),
      thresholdDescription: state(
        () => `${threshold()} of ${guardians().length} guardians needed to recover`,
        'The recovery threshold in words.',
      ),
      guardianRecoveryLabel: state(
        () => `Ask ${threshold()} of your ${guardians().length} guardians to approve recovery`,
        'The label of the guardian recovery button.',
      ),
      selectedDevice: state(() => {
        const id = selectedDeviceId();
        return id ? (roster().find((e: R) => e.id === id) ?? null) : null;
      }, 'The full entry of the selected device, or null.'),

      // ── Device selection ──
      selectedDeviceId: state(selectedDeviceId, 'The id of the selected device, or null.'),
      selectDevice: action((id: unknown) => setSelectedDeviceId(id as string), 'Select a device for the detail view.'),
      clearSelection: action(() => setSelectedDeviceId(null), 'Close the device detail view.'),

      // ── Actions ──
      copyDid: action(() => {
        const did = (identity() as R | null)?.did;
        if (did && typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(did as string).catch(() => {
            /* clipboard unavailable — silent */
          });
        }
      }, 'Copy the DID to the clipboard.'),
      dismissEnrolment: action(() => setEnrolmentOffer(null), 'Close the enrolment offer.'),

      // ── Actions the host's identity wiring replaces after auth (see wireIdentityModule) ──
      revokeKey: wiredByHost('Revoke a key and refresh the roster.'),
      exportKel: wiredByHost('Download the key event log as a JSON file.'),
      startMnemonicRecovery: wiredByHost('Open the recovery-phrase ceremony.'),
      startGuardianRecovery: wiredByHost('Open the guardian recovery ceremony.'),
      vetoRecovery: wiredByHost('Veto the active recovery request.'),
      approveRecovery: wiredByHost('Approve an incoming recovery request.'),
      startBackup: wiredByHost('Begin the recovery-phrase backup ceremony.'),
      startEnrolment: wiredByHost('Create an enrolment offer and its QR code.'),
      addGuardian: wiredByHost('Begin adding a guardian.'),

      // ── Data setters: the host's wiring calls these; templates never see them ──
      setIdentity,
      setRoster,
      setGuardians,
      setKelEvents,
      setRecoveryState,
      setBackupConfirmed,
      setIncomingRecoveryRequests,
      setEnrolmentOffer,
    };
  },
});

/** The one factory shape every module package exports — the generated registry imports it. */
export const createModule = (_host: ModuleHost): ModuleDefinition => identityModule;
