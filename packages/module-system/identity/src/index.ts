/**
 * The Identity module — your DID, devices, guardians, recovery, and event log.
 *
 * Agent-scoped: appears in the module rail everywhere, not tied to any space. A hard boundary
 * stands — this module talks ONLY to the agent language (identity client), never the perspective DB.
 * Key generation happens on-device; the password and mnemonic never leave the device.
 *
 * ## Fragments, not components
 *
 * Every piece of UI here uses a `SchemaNode`. Nothing in this package imports Solid, React, or any
 * framework — `Column`, `we-button`, `we-tabs` are registry keys resolved by whichever renderer
 * runs. The module stays Tier 1: framework code only for imperative cores, and an identity panel
 * has none.
 *
 * ## Where state lives
 *
 * - **Identity data** — signals on the store (`identity`, `roster`, `guardians`, `kelEvents`,
 *   `recoveryState`), populated by the host's wiring to the identity client when it lands.
 *   Schema fragments read them via `$: 'modules.identity.<field>'`.
 * - **Tab selection** — `$localState` in the panel, resets to 'home' on panel reopen.
 * - **Detail drill-down** — `$localState` for the selected device id, same lifecycle.
 * - **Panel open/closed** — store signal, same pattern as Notes.
 *
 * ## Data flow
 *
 * The store exposes the data shape the identity client will provide. Each signal starts empty/null
 * and the host populates them when the identity RPC client connects. Schema fragments degrade
 * gracefully — `$if` guards render loading or empty states until data arrives.
 */
import { defineModule, type ModuleStoreDeps } from '@we/module-shared';
import type { SchemaNode } from '@we/schema-shared';

// ─── Reusable fragment builders ──────────────────────────────────────────────

/**
 * One device or assistant in the roster list.
 *
 * Tapping navigates to the detail view. The status dot shows active (green) or revoked (red).
 * Each row shows the label, scope summary, and delegation date.
 */
const rosterEntry: SchemaNode = {
  type: 'Row',
  props: {
    bg: 'surface-raised',
    r: '300',
    p: '300',
    gap: '300',
    ay: 'center',
    cursor: 'pointer',
    onClick: { $action: 'modules.identity.selectDevice', args: [{ $: 'entry.id' }] },
  },
  children: [
    // Type icon
    {
      type: 'we-icon',
      props: { name: { $: 'entry.icon' }, size: 'md' },
    },
    // Label + meta
    {
      type: 'Column',
      props: { gap: '50', flex: '1', overflow: 'hidden' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'body-sm', fontWeight: '500' },
          children: [{ $: 'entry.label' }],
        },
        {
          type: 'we-text',
          props: { variant: 'caption', color: 'text-muted' },
          children: [{ $: 'entry.scopeSummary' }],
        },
      ],
    },
    // Active/revoked indicator
    {
      type: '$if',
      props: {
        condition: { $: 'entry.active' },
        then: { type: 'we-badge', props: { variant: 'success', size: 'xs' }, children: ['Active'] },
        else: { type: 'we-badge', props: { variant: 'danger', size: 'xs' }, children: ['Revoked'] },
      },
    },
    // Chevron
    { type: 'we-icon', props: { name: 'caret-right', size: 'sm', color: 'text-dim' } },
  ],
};

/** A guardian entry — avatar, name, truncated DID, consent status. */
const guardianEntry: SchemaNode = {
  type: 'Row',
  props: {
    bg: 'surface-raised',
    r: '300',
    p: '300',
    gap: '300',
    ay: 'center',
  },
  children: [
    { type: 'we-avatar', props: { name: { $: 'guardian.name' }, size: 'sm' } },
    {
      type: 'Column',
      props: { gap: '50', flex: '1', overflow: 'hidden' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'body-sm', fontWeight: '500' },
          children: [{ $: 'guardian.name' }],
        },
        {
          type: 'we-text',
          props: { variant: 'caption', color: 'text-muted', truncate: true },
          children: [{ $: 'guardian.did' }],
        },
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'guardian.consented' },
        then: { type: 'we-tag', props: { variant: 'success' }, children: ['Consented'] },
        else: { type: 'we-tag', props: { variant: 'warning' }, children: ['Pending'] },
      },
    },
  ],
};

/** A single KEL event row — sequence number, event type, summary. */
const kelEventRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', py: '200', borderBottom: '1px solid var(--we-color-border)' },
  children: [
    // Sequence number
    {
      type: 'we-text',
      props: {
        variant: 'caption',
        color: 'text-dim',
        fontFamily: 'mono',
        width: '28px',
        textAlign: 'right',
        flex: '0 0 auto',
      },
      children: [{ $: 'kelEvent.seqLabel' }],
    },
    // Event body
    {
      type: 'Column',
      props: { gap: '50', flex: '1' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'caption', fontWeight: '600', color: 'accent' },
          children: [{ $: 'kelEvent.type' }],
        },
        {
          type: 'we-text',
          props: { variant: 'caption', color: 'text-muted' },
          children: [{ $: 'kelEvent.summary' }],
        },
      ],
    },
  ],
};

// ─── View fragments ──────────────────────────────────────────────────────────

/** DID banner at the top of the home view — avatar, display name, truncated DID, copy button. */
const didBanner: SchemaNode = {
  type: 'Row',
  props: { bg: 'surface-raised', r: '400', p: '400', gap: '300', ay: 'center' },
  children: [
    { type: 'we-avatar', props: { name: { $: 'modules.identity.identity.name' }, size: 'md' } },
    {
      type: 'Column',
      props: { gap: '50', flex: '1', overflow: 'hidden' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'body-sm', fontWeight: '600' },
          children: [{ $: 'modules.identity.identity.name' }],
        },
        {
          type: 'we-text',
          props: { variant: 'caption', color: 'text-muted', fontFamily: 'mono', truncate: true },
          children: [{ $: 'modules.identity.identity.did' }],
        },
      ],
    },
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        size: 'xs',
        onClick: { $action: 'modules.identity.copyDid' },
      },
      children: [{ type: 'we-icon', props: { name: 'copy' } }],
    },
  ],
};

/**
 * Backup nag banner — shown when the mnemonic backup remains unconfirmed.
 *
 * Visible, amber, persistent until the user backs up. The action starts the backup ceremony
 * (deferred to the host's identity client wiring).
 */
const backupNag: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: '!modules.identity.backupConfirmed' },
    then: {
      type: 'Row',
      props: {
        bg: 'warning-surface',
        r: '300',
        p: '300',
        gap: '200',
        ay: 'center',
      },
      children: [
        { type: 'we-icon', props: { name: 'warning', color: 'warning-text' } },
        {
          type: 'we-text',
          props: { variant: 'caption', color: 'warning-text', flex: '1' },
          children: ['Back up your recovery phrase — without it, losing all devices means losing this identity.'],
        },
        {
          type: 'we-button',
          props: { variant: 'ghost', size: 'xs' },
          children: ['Back up'],
        },
      ],
    },
  },
};

/** Status badges — backup status and guardian count. */
const statusRow: SchemaNode = {
  type: 'Row',
  props: { gap: '200' },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: 'modules.identity.backupConfirmed' },
        then: {
          type: 'we-badge',
          props: { variant: 'success', size: 'sm' },
          children: [{ type: 'we-icon', props: { name: 'check-circle', size: 'xs' } }, ' Backup secured'],
        },
        else: {
          type: 'we-badge',
          props: { variant: 'warning', size: 'sm' },
          children: [{ type: 'we-icon', props: { name: 'warning', size: 'xs' } }, ' No backup'],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $: 'modules.identity.guardianCount' },
        then: {
          type: 'we-badge',
          props: { variant: 'success', size: 'sm' },
          children: [
            { type: 'we-icon', props: { name: 'shield-check', size: 'xs' } },
            ' ',
            { $: 'modules.identity.guardianCount' },
            ' guardians',
          ],
        },
      },
    },
  ],
};

/** Section header — title + optional count badge. */
const sectionHeader = (title: string, countExpr?: string): SchemaNode => ({
  type: 'Row',
  props: { ay: 'center', pt: '400', pb: '200' },
  children: [
    {
      type: 'we-text',
      props: {
        variant: 'caption',
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        color: 'text-muted',
        flex: '1',
      },
      children: [title],
    },
    ...(countExpr
      ? [
          {
            type: 'we-badge' as const,
            props: { variant: 'neutral' as const, size: 'xs' as const },
            children: [{ $: countExpr }],
          },
        ]
      : []),
  ],
});

// ─── Detail view (within the home tab) ───────────────────────────────────────

/**
 * Device/key detail view — replaces the home overview when a roster entry gets tapped.
 *
 * Shows full key information, scopes, and the revocation section with consequences.
 * The back button clears the selection and returns to the overview.
 */
const deviceDetail: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    // Back navigation
    {
      type: 'Row',
      props: {
        gap: '200',
        ay: 'center',
        cursor: 'pointer',
        onClick: { $action: 'modules.identity.clearSelection' },
      },
      children: [
        { type: 'we-icon', props: { name: 'arrow-left', size: 'sm', color: 'text-muted' } },
        {
          type: 'we-text',
          props: { variant: 'body-sm', color: 'text-muted' },
          children: ['Back'],
        },
      ],
    },

    // Detail card
    {
      type: 'Column',
      props: { bg: 'surface-raised', r: '400', p: '400', gap: '400' },
      children: [
        // Label
        detailField('Label', { $: 'modules.identity.selectedDevice.label' }),
        // Key ID
        detailField('Key ID', { $: 'modules.identity.selectedDevice.keyId' }, true),
        // Signing key
        detailField('Signing key', { $: 'modules.identity.selectedDevice.signingKey' }, true),
        // Delegated at
        detailField('Delegated at', { $: 'modules.identity.selectedDevice.delegatedAt' }),
        // Scopes
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            {
              type: 'we-text',
              props: {
                variant: 'caption',
                color: 'text-muted',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              },
              children: ['Scope'],
            },
            {
              type: 'Row',
              props: { gap: '200', flexWrap: 'wrap' },
              children: [
                {
                  type: '$each',
                  props: {
                    items: { $: 'modules.identity.selectedDevice.scopes' },
                    as: 'scope',
                  },
                  children: [{ type: 'we-tag', props: { variant: 'neutral' }, children: [{ $: 'scope' }] }],
                },
              ],
            },
          ],
        },
        // Encryption key (when present)
        {
          type: '$if',
          props: {
            condition: { $: 'modules.identity.selectedDevice.encryptionKey' },
            then: detailField('Encryption key', { $: 'modules.identity.selectedDevice.encryptionKey' }, true),
          },
        },
      ],
    },

    // Revocation section
    {
      type: '$if',
      props: {
        condition: { $: 'modules.identity.selectedDevice.active' },
        then: {
          type: 'Column',
          props: {
            bg: 'surface-raised',
            r: '400',
            p: '400',
            gap: '300',
            border: '1px solid var(--we-color-danger-surface)',
          },
          children: [
            {
              type: 'we-text',
              props: { variant: 'body-sm', fontWeight: '600', color: 'danger' },
              children: ['Revoke this key'],
            },
            revokeConsequence('Everything this key signed until now stays valid.'),
            revokeConsequence('This key can no longer sign anything new as you.'),
            revokeConsequence('You cannot undo a revocation.'),
            {
              type: 'we-button',
              props: {
                variant: 'danger',
                size: 'sm',
                onClick: { $action: 'modules.identity.revokeKey', args: [{ $: 'modules.identity.selectedDevice.id' }] },
              },
              children: ['Revoke key'],
            },
          ],
        },
      },
    },
  ],
};

/** A labelled field in the detail card. */
function detailField(label: string, value: unknown, mono = false): SchemaNode {
  return {
    type: 'Column',
    props: { gap: '100' },
    children: [
      {
        type: 'we-text',
        props: {
          variant: 'caption',
          color: 'text-muted',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        },
        children: [label],
      },
      {
        type: 'we-text',
        props: {
          variant: 'body-sm',
          ...(mono ? { fontFamily: 'mono', wordBreak: 'break-all' } : {}),
        },
        children: [value as string],
      },
    ],
  };
}

/** One bullet point in the revocation consequences list. */
function revokeConsequence(text: string): SchemaNode {
  return {
    type: 'Row',
    props: { gap: '200', pl: '200' },
    children: [
      { type: 'we-text', props: { variant: 'caption', color: 'text-dim' }, children: ['•'] },
      { type: 'we-text', props: { variant: 'caption', color: 'text-muted' }, children: [text] },
    ],
  };
}

// ─── Tab content fragments ───────────────────────────────────────────────────

/** Home tab — overview or detail, depending on whether a device has been selected. */
const homeTab: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.identity.selectedDeviceId' },
    then: deviceDetail,
    else: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        didBanner,
        backupNag,
        statusRow,

        // Devices section
        sectionHeader('Devices', 'modules.identity.deviceCount'),
        {
          type: 'Column',
          props: { gap: '200' },
          children: [
            {
              type: '$each',
              props: {
                items: { $: 'modules.identity.devices' },
                as: 'entry',
              },
              children: [rosterEntry],
            },
          ],
        },

        // Assistants section
        {
          type: '$if',
          props: {
            condition: { $: 'modules.identity.assistants.length' },
            then: {
              type: 'Column',
              props: { gap: '200' },
              children: [
                sectionHeader('Assistants', 'modules.identity.assistantCount'),
                {
                  type: '$each',
                  props: {
                    items: { $: 'modules.identity.assistants' },
                    as: 'entry',
                  },
                  children: [rosterEntry],
                },
              ],
            },
          },
        },

        // Add button
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            width: '100%',
          },
          children: [{ type: 'we-icon', props: { name: 'plus' } }, ' Add device or assistant'],
        },
      ],
    },
  },
};

/** Guardians tab — threshold display, guardian list, add guardian. */
const guardiansTab: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    // Threshold display
    {
      type: '$if',
      props: {
        condition: { $: 'modules.identity.guardians.length' },
        then: {
          type: 'Row',
          props: { bg: 'surface-raised', r: '400', p: '400', gap: '300', ay: 'center' },
          children: [
            // Threshold ring (text-based for schema simplicity)
            {
              type: 'Column',
              props: {
                ay: 'center',
                ax: 'center',
                width: '44px',
                height: '44px',
                r: 'pill',
                border: '3px solid var(--we-color-success)',
                flex: '0 0 auto',
              },
              children: [
                {
                  type: 'we-text',
                  props: { variant: 'body-sm', fontWeight: '700' },
                  children: [{ $: 'modules.identity.thresholdLabel' }],
                },
              ],
            },
            {
              type: 'Column',
              props: { gap: '50', flex: '1' },
              children: [
                {
                  type: 'we-text',
                  props: { variant: 'body-sm', fontWeight: '500' },
                  children: ['Recovery threshold'],
                },
                {
                  type: 'we-text',
                  props: { variant: 'caption', color: 'text-muted' },
                  children: [{ $: 'modules.identity.thresholdDescription' }],
                },
              ],
            },
          ],
        },
      },
    },

    sectionHeader('Guardians'),

    // Guardian list
    {
      type: 'Column',
      props: { gap: '200' },
      children: [
        {
          type: '$each',
          props: {
            items: { $: 'modules.identity.guardians' },
            as: 'guardian',
          },
          children: [guardianEntry],
        },
      ],
    },

    // Add guardian button
    {
      type: 'we-button',
      props: { variant: 'ghost', size: 'sm', width: '100%' },
      children: [{ type: 'we-icon', props: { name: 'plus' } }, ' Add guardian'],
    },

    // Pending consent warning
    {
      type: '$if',
      props: {
        condition: { $: 'modules.identity.pendingGuardians' },
        then: {
          type: 'Row',
          props: { bg: 'warning-surface', r: '300', p: '300', gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'warning', size: 'sm', color: 'warning-text' } },
            {
              type: 'we-text',
              props: { variant: 'caption', color: 'warning-text', flex: '1' },
              children: [
                'One or more guardians have not accepted yet. The roster cannot arm until all guardians consent.',
              ],
            },
          ],
        },
      },
    },

    // Empty state
    {
      type: '$if',
      props: {
        condition: { $: '!modules.identity.guardians.length' },
        then: {
          type: 'Column',
          props: { bg: 'surface-raised', r: '400', p: '400', gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'shield', size: 'lg', color: 'text-dim' } },
            {
              type: 'we-text',
              props: { variant: 'body-sm', color: 'text-muted', textAlign: 'center' },
              children: [
                'No guardians set up yet. Add guardians who can help recover your identity if you lose all devices.',
              ],
            },
          ],
        },
      },
    },
  ],
};

/** Recovery tab — recovery methods and incoming recovery requests. */
const recoveryTab: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    // Recovery methods card
    {
      type: 'Column',
      props: { bg: 'surface-raised', r: '400', p: '400', gap: '300' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'body-sm', fontWeight: '600' },
          children: ['Recovery methods'],
        },
        {
          type: 'we-text',
          props: { variant: 'caption', color: 'text-muted' },
          children: ['Lost all your devices? Use one of these methods to regain access.'],
        },
        // Mnemonic recovery
        recoveryMethod(
          'key',
          'Recovery phrase',
          'Enter your 12-word mnemonic on a new device',
          'modules.identity.startMnemonicRecovery',
        ),
        // Guardian recovery
        {
          type: '$if',
          props: {
            condition: { $: 'modules.identity.guardians.length' },
            then: recoveryMethod(
              'shield-check',
              'Guardian recovery',
              { $: 'modules.identity.guardianRecoveryLabel' } as unknown as string,
              'modules.identity.startGuardianRecovery',
            ),
          },
        },
      ],
    },

    // Active recovery request
    {
      type: '$if',
      props: {
        condition: { $: 'modules.identity.recoveryState' },
        then: {
          type: 'Column',
          props: {
            bg: 'surface-raised',
            r: '400',
            p: '400',
            gap: '300',
            border: '1px solid var(--we-color-accent)',
          },
          children: [
            {
              type: 'we-text',
              props: { variant: 'body-sm', fontWeight: '600', color: 'accent' },
              children: ['Recovery in progress'],
            },
            {
              type: 'we-text',
              props: { variant: 'caption', color: 'text-muted' },
              children: [{ $: 'modules.identity.recoveryState.statusLabel' }],
            },
            {
              type: 'we-progress-bar',
              props: {
                value: { $: 'modules.identity.recoveryState.approvals' },
                max: { $: 'modules.identity.recoveryState.threshold' },
              },
            },
            {
              type: 'Row',
              props: { gap: '200' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'danger',
                    size: 'sm',
                    onClick: { $action: 'modules.identity.vetoRecovery' },
                  },
                  children: ['Veto'],
                },
              ],
            },
          ],
        },
      },
    },

    // As a guardian — incoming requests
    {
      type: 'Column',
      props: {
        bg: 'surface-raised',
        r: '400',
        p: '400',
        gap: '200',
        border: '1px solid var(--we-color-border)',
      },
      children: [
        {
          type: 'we-text',
          props: { variant: 'body-sm', fontWeight: '600' },
          children: ['As a guardian'],
        },
        {
          type: '$if',
          props: {
            condition: { $: 'modules.identity.incomingRecoveryRequests.length' },
            then: {
              type: '$each',
              props: {
                items: { $: 'modules.identity.incomingRecoveryRequests' },
                as: 'request',
              },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center', p: '200' },
                  children: [
                    { type: 'we-avatar', props: { name: { $: 'request.requesterName' }, size: 'sm' } },
                    {
                      type: 'Column',
                      props: { gap: '50', flex: '1' },
                      children: [
                        {
                          type: 'we-text',
                          props: { variant: 'body-sm' },
                          children: [{ $: 'request.requesterName' }],
                        },
                        {
                          type: 'we-text',
                          props: { variant: 'caption', color: 'text-muted' },
                          children: ['Requesting recovery'],
                        },
                      ],
                    },
                    {
                      type: 'we-button',
                      props: {
                        variant: 'primary',
                        size: 'xs',
                        onClick: { $action: 'modules.identity.approveRecovery', args: [{ $: 'request.id' }] },
                      },
                      children: ['Approve'],
                    },
                  ],
                },
              ],
            },
            else: {
              type: 'we-text',
              props: { variant: 'caption', color: 'text-muted' },
              children: ['No pending recovery requests from anyone you guard.'],
            },
          },
        },
      ],
    },
  ],
};

/** A recovery method button — icon, title, description, chevron. */
function recoveryMethod(icon: string, title: string, description: string, action: string): SchemaNode {
  return {
    type: 'Row',
    props: {
      bg: 'surface',
      r: '300',
      p: '300',
      gap: '300',
      ay: 'center',
      cursor: 'pointer',
      border: '1px solid var(--we-color-border)',
      onClick: { $action: action },
    },
    children: [
      { type: 'we-icon', props: { name: icon, size: 'md' } },
      {
        type: 'Column',
        props: { gap: '50', flex: '1' },
        children: [
          { type: 'we-text', props: { variant: 'body-sm', fontWeight: '500' }, children: [title] },
          { type: 'we-text', props: { variant: 'caption', color: 'text-muted' }, children: [description] },
        ],
      },
      { type: 'we-icon', props: { name: 'caret-right', size: 'sm', color: 'text-dim' } },
    ],
  };
}

/** Log tab — KEL event list + export button. */
const logTab: SchemaNode = {
  type: 'Column',
  props: { gap: '200' },
  children: [
    {
      type: '$each',
      props: {
        items: { $: 'modules.identity.kelEvents' },
        as: 'kelEvent',
      },
      children: [kelEventRow],
    },
    // Empty state
    {
      type: '$if',
      props: {
        condition: { $: '!modules.identity.kelEvents.length' },
        then: {
          type: 'Column',
          props: { py: '400', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'scroll', size: 'lg', color: 'text-dim' } },
            {
              type: 'we-text',
              props: { variant: 'body-sm', color: 'text-muted', textAlign: 'center' },
              children: ['No events yet.'],
            },
          ],
        },
      },
    },
    // Export button
    {
      type: '$if',
      props: {
        condition: { $: 'modules.identity.kelEvents.length' },
        then: {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'sm',
            width: '100%',
            onClick: { $action: 'modules.identity.exportKel' },
          },
          children: [{ type: 'we-icon', props: { name: 'download-simple' } }, ' Export event log (JSON)'],
        },
      },
    },
  ],
};

// ─── Loading state ───────────────────────────────────────────────────────────

const loadingState: SchemaNode = {
  type: 'Column',
  props: { py: '500', ay: 'center', ax: 'center', gap: '300' },
  children: [
    { type: 'we-spinner', props: { size: 'md' } },
    {
      type: 'we-text',
      props: { variant: 'body-sm', color: 'text-muted' },
      children: ['Loading identity…'],
    },
  ],
};

// ─── The panel ───────────────────────────────────────────────────────────────

/**
 * The docked panel — header with tabs, scrollable body with view switching.
 *
 * `$localState` holds the tab selection and detail drill-down state. Both reset when the panel
 * closes and reopens, which lands the user on the home overview — the expected landing spot.
 */
const panel: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.identity.open' },
    then: {
      type: 'Column',
      props: { width: '100%', height: '100%', overflow: 'hidden' },
      $localState: {
        tab: { type: 'string', initial: 'home' },
      },
      children: [
        // Panel header — title + tabs
        {
          type: 'Column',
          props: { p: '400', pb: '300', gap: '300', borderBottom: '1px solid var(--we-color-border)' },
          children: [
            { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Identity'] },
            {
              type: 'we-tabs',
              props: {
                selectedKey: { $: 'local.tab' },
                onChange: { $setLocal: 'tab', value: { $: 'event.detail.value' } },
              },
              children: [
                { type: 'we-tab', props: { key: 'home' }, children: ['Home'] },
                { type: 'we-tab', props: { key: 'guardians' }, children: ['Guardians'] },
                { type: 'we-tab', props: { key: 'recovery' }, children: ['Recovery'] },
                { type: 'we-tab', props: { key: 'log' }, children: ['Log'] },
              ],
            },
          ],
        },

        // Panel body — scrollable, switches content by tab
        {
          type: 'we-scroll-area',
          props: { flex: '1' },
          children: [
            {
              type: 'Column',
              props: { p: '400', gap: '300' },
              children: [
                // Show loading state until identity data arrives
                {
                  type: '$if',
                  props: {
                    condition: { $: 'modules.identity.identity' },
                    then: {
                      type: 'Column',
                      children: [
                        // Home tab
                        {
                          type: '$if',
                          props: { condition: { $: "local.tab === 'home'" }, then: homeTab },
                        },
                        // Guardians tab
                        {
                          type: '$if',
                          props: { condition: { $: "local.tab === 'guardians'" }, then: guardiansTab },
                        },
                        // Recovery tab
                        {
                          type: '$if',
                          props: { condition: { $: "local.tab === 'recovery'" }, then: recoveryTab },
                        },
                        // Log tab
                        {
                          type: '$if',
                          props: { condition: { $: "local.tab === 'log'" }, then: logTab },
                        },
                      ],
                    },
                    else: loadingState,
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  },
};

// ─── Module definition ───────────────────────────────────────────────────────

export const identityModule = defineModule({
  id: 'identity',
  name: 'Identity',
  description: 'Your DID, enrolled devices, guardians, recovery, and event log.',
  icon: 'fingerprint',

  /**
   * Agent-scoped — the identity panel belongs to the person, not a community.
   *
   * The launcher appears in the rail everywhere, including outside a space. The data comes from
   * the agent language (identity client), which has nothing to do with any space's dataset.
   */
  scope: 'agent',

  capabilities: ['dock'],

  docks: [{ edge: 'dockEdge', size: 'dockSize', float: 'dockFloat', close: 'close', node: panel }],

  launcher: {
    icon: 'fingerprint',
    label: 'Identity',
    action: 'toggle',
    activeWhen: 'open',
  },

  createStore: ({ signal }: ModuleStoreDeps) => {
    const [open, setOpen] = signal(false);

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
      // ── Panel state ──
      open,
      dockEdge: () => (open() ? 'right' : null),
      dockSize: () => 'md' as const,
      dockFloat: () => false,
      toggle: () => setOpen(!open()),
      close: () => setOpen(false),

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

      // Placeholder actions — wired to the identity client when it lands.
      revokeKey: (_keyId: unknown) => {
        /* Wired by the host's identity client integration. */
      },
      exportKel: () => {
        /* Wired by the host — downloads KEL as JSON. */
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
