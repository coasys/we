/**
 * Identity settings — devices, guardians, recovery, and event log.
 *
 * Rendered on the Account page of Settings. The identity module provides the data store
 * (`modules.identity.*` signals); this file provides the layout. No import from the module
 * package — store paths resolve at runtime because the module has `scope: 'agent'` and
 * always registers.
 *
 * ## Why this duplicates the dock panel's layout
 *
 * The dock panel had its own `$localState` and its own container (`panel` in the module source).
 * Settings embeds the same content differently: no panel header, no dock frame, no toggle —
 * just sections in a scrolling page. Sharing schema fragments across packages would require a
 * cross-package import that the dependency graph should not carry (templates do not depend on
 * specific modules), so the layout lives here and the data lives in the module.
 */
import type { SchemaNode } from '@we/schema-shared';

// ─── Reusable fragment builders ──────────────────────────────────────────────

/** One device or assistant in the roster list. */
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
    { type: 'we-icon', props: { name: { $: 'entry.icon' }, size: 'md' } },
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
    {
      type: '$if',
      props: {
        condition: { $: 'entry.active' },
        then: { type: 'we-badge', props: { variant: 'success', size: 'xs' }, children: ['Active'] },
        else: { type: 'we-badge', props: { variant: 'danger', size: 'xs' }, children: ['Revoked'] },
      },
    },
    { type: 'we-icon', props: { name: 'caret-right', size: 'sm', color: 'text-dim' } },
  ],
};

/** A guardian entry — avatar, name, truncated DID, consent status. */
const guardianEntry: SchemaNode = {
  type: 'Row',
  props: { bg: 'surface-raised', r: '300', p: '300', gap: '300', ay: 'center' },
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

/** A single KEL event row. */
const kelEventRow: SchemaNode = {
  type: 'Row',
  props: { gap: '300', py: '200', borderBottom: '1px solid var(--we-color-border)' },
  children: [
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

/** A labelled detail field. */
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

/** Section header with optional count badge. */
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

/** A recovery method button. */
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

// ─── Device detail ──────────────────────────────────────────────────────────

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
        { type: 'we-text', props: { variant: 'body-sm', color: 'text-muted' }, children: ['Back'] },
      ],
    },
    // Detail card
    {
      type: 'Column',
      props: { bg: 'surface-raised', r: '400', p: '400', gap: '400' },
      children: [
        detailField('Label', { $: 'modules.identity.selectedDevice.label' }),
        detailField('Key ID', { $: 'modules.identity.selectedDevice.keyId' }, true),
        detailField('Signing key', { $: 'modules.identity.selectedDevice.signingKey' }, true),
        detailField('Delegated at', { $: 'modules.identity.selectedDevice.delegatedAt' }),
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
                  props: { items: { $: 'modules.identity.selectedDevice.scopes' }, as: 'scope' },
                  children: [{ type: 'we-tag', props: { variant: 'neutral' }, children: [{ $: 'scope' }] }],
                },
              ],
            },
          ],
        },
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
                onClick: {
                  $action: 'modules.identity.revokeKey',
                  args: [{ $: 'modules.identity.selectedDevice.id' }],
                },
              },
              children: ['Revoke key'],
            },
          ],
        },
      },
    },
  ],
};

// ─── Tab content ────────────────────────────────────────────────────────────

/** Devices tab — roster overview or device detail. */
const devicesTab: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.identity.selectedDeviceId' },
    then: deviceDetail,
    else: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        // Devices
        sectionHeader('Devices', 'modules.identity.deviceCount'),
        {
          type: 'Column',
          props: { gap: '200' },
          children: [
            {
              type: '$each',
              props: { items: { $: 'modules.identity.devices' }, as: 'entry' },
              children: [rosterEntry],
            },
          ],
        },
        // Assistants
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
                  props: { items: { $: 'modules.identity.assistants' }, as: 'entry' },
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
            onClick: { $action: 'modules.identity.startEnrolment' },
          },
          children: [{ type: 'we-icon', props: { name: 'plus' } }, ' Add device or assistant'],
        },
      ],
    },
  },
};

/** Guardians tab — threshold, guardian list, add, warnings. */
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
    {
      type: 'Column',
      props: { gap: '200' },
      children: [
        {
          type: '$each',
          props: { items: { $: 'modules.identity.guardians' }, as: 'guardian' },
          children: [guardianEntry],
        },
      ],
    },
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        size: 'sm',
        width: '100%',
        onClick: { $action: 'modules.identity.addGuardian' },
      },
      children: [{ type: 'we-icon', props: { name: 'plus' } }, ' Add guardian'],
    },
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

/** Recovery tab — methods, active recovery, incoming requests. */
const recoveryTab: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
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
        recoveryMethod(
          'key',
          'Recovery phrase',
          'Enter your 12-word mnemonic on a new device',
          'modules.identity.startMnemonicRecovery',
        ),
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
      props: { bg: 'surface-raised', r: '400', p: '400', gap: '200', border: '1px solid var(--we-color-border)' },
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
                        { type: 'we-text', props: { variant: 'body-sm' }, children: [{ $: 'request.requesterName' }] },
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
                        onClick: {
                          $action: 'modules.identity.approveRecovery',
                          args: [{ $: 'request.id' }],
                        },
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

/** Log tab — KEL events and export. */
const logTab: SchemaNode = {
  type: 'Column',
  props: { gap: '200' },
  children: [
    {
      type: '$each',
      props: { items: { $: 'modules.identity.kelEvents' }, as: 'kelEvent' },
      children: [kelEventRow],
    },
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

// ─── The settings section ───────────────────────────────────────────────────

/**
 * Identity section for the Account settings page.
 *
 * Gated on `modules.identity` — the module always registers (agent-scoped), but the guard
 * degrades cleanly if it ever does not. Shows a backup nag, status badges, and tabbed content
 * for devices, guardians, recovery, and event log.
 */
export const identitySection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.identity' },
    then: {
      type: 'Column',
      props: { gap: '300' },
      $localState: {
        tab: { type: 'string', initial: 'devices' },
      },
      children: [
        // Section heading
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'fingerprint', size: '20px' } },
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Identity'] },
          ],
        },

        // Loading state or content
        {
          type: '$if',
          props: {
            condition: { $: 'modules.identity.identity' },
            then: {
              type: 'Column',
              props: { gap: '300' },
              children: [
                // Backup nag
                {
                  type: '$if',
                  props: {
                    condition: { $: '!modules.identity.backupConfirmed' },
                    then: {
                      type: 'Row',
                      props: { bg: 'warning-surface', r: '300', p: '300', gap: '200', ay: 'center' },
                      children: [
                        { type: 'we-icon', props: { name: 'warning', color: 'warning-text' } },
                        {
                          type: 'we-text',
                          props: { variant: 'caption', color: 'warning-text', flex: '1' },
                          children: [
                            'Back up your recovery phrase — without it, losing all devices means losing this identity.',
                          ],
                        },
                        {
                          type: 'we-button',
                          props: {
                            variant: 'ghost',
                            size: 'xs',
                            onClick: { $action: 'modules.identity.startBackup' },
                          },
                          children: ['Back up'],
                        },
                      ],
                    },
                  },
                },

                // Status badges
                {
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
                          children: [
                            { type: 'we-icon', props: { name: 'check-circle', size: 'xs' } },
                            ' Backup secured',
                          ],
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
                },

                // Tabs
                {
                  type: 'we-tabs',
                  props: {
                    selectedKey: { $: 'local.tab' },
                    onChange: { $setLocal: 'tab', value: { $: 'event.detail.value' } },
                  },
                  children: [
                    { type: 'we-tab', props: { key: 'devices' }, children: ['Devices'] },
                    { type: 'we-tab', props: { key: 'guardians' }, children: ['Guardians'] },
                    { type: 'we-tab', props: { key: 'recovery' }, children: ['Recovery'] },
                    { type: 'we-tab', props: { key: 'log' }, children: ['Log'] },
                  ],
                },

                // Tab content
                {
                  type: 'Column',
                  children: [
                    {
                      type: '$if',
                      props: { condition: { $: "local.tab == 'devices'" }, then: devicesTab },
                    },
                    {
                      type: '$if',
                      props: { condition: { $: "local.tab == 'guardians'" }, then: guardiansTab },
                    },
                    {
                      type: '$if',
                      props: { condition: { $: "local.tab == 'recovery'" }, then: recoveryTab },
                    },
                    {
                      type: '$if',
                      props: { condition: { $: "local.tab == 'log'" }, then: logTab },
                    },
                  ],
                },
              ],
            },
            else: {
              // Loading state
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
            },
          },
        },
      ],
    },
  },
};
