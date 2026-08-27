import type { SchemaNode } from '@we/schema-shared';
import { confirmModal } from '@we/template-kit';

/**
 * ConsentPrompt — the modal for requests the backend raises while the app runs.
 *
 * Registered as shell chrome rather than living in the settings page, because the request does not
 * arrive when the user is looking at settings. It arrives when an embedded app in a `we-iframe`
 * asks for credentials, which is whenever that app happens to load. On a host that bundles the
 * executor there is no launcher window to show it, so before this the request went unanswered and
 * the iframe sat blank until it timed out.
 *
 * Two request kinds share one dialog. A capability request names the app and what it is asking
 * for; a trust request names a peer. The difference is what the body says — the decision, and the
 * consequence of getting it wrong, are the same shape.
 */
export const consentPrompt: SchemaNode = confirmModal({
  open: { $store: 'runtimeStore.pendingConsent' },
  /*
    Dismissing is denying, which is the safe direction — the app asks again, and nothing was
    granted by a click that missed. Worth stating because the hand-rolled scrim this replaced had
    no dismissal at all: no backdrop handler and no Escape, so the only way out of a consent
    request was the two buttons, and a keyboard user who could not reach them was simply stuck.
  */
  close: { $action: 'runtimeStore.denyConsent' },
  // The backend's own title, so a request type we don't specifically recognise still says
  // something true rather than nothing.
  title: { $store: 'runtimeStore.pendingConsent.title' },
  tone: 'primary',
  icon: 'shield-check',
  children: [
    // Capability requests: who is asking, and for what.
    {
      type: '$if',
      props: {
        condition: { $eq: [{ $store: 'runtimeStore.pendingConsent.kind' }, 'capability'] },
        then: {
          type: 'Column',
          props: { gap: '400' },
          children: [
            {
              type: 'Row',
              props: { gap: '300', ay: 'center' },
              children: [
                {
                  type: 'we-avatar',
                  props: { image: { $store: 'runtimeStore.pendingConsent.app.iconUrl' }, size: 'md' },
                },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'we-text',
                      props: { variant: 'label' },
                      children: [{ $store: 'runtimeStore.pendingConsent.app.name' }],
                    },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-muted' },
                      children: [{ $store: 'runtimeStore.pendingConsent.app.url' }],
                    },
                  ],
                },
              ],
            },
            {
              type: 'we-text',
              props: { variant: 'label', color: 'text-muted' },
              children: ['Wants permission to:'],
            },
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                {
                  type: '$each',
                  props: { items: { $store: 'runtimeStore.pendingConsent.app.capabilities' }, as: 'cap' },
                  children: [
                    {
                      type: 'Row',
                      props: { gap: '200', ay: 'center' },
                      children: [
                        { type: 'we-icon', props: { name: 'check', color: 'success-text' } },
                        { type: 'we-text', props: { variant: 'body' }, children: ['$cap'] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },

    // Trust requests: which peer, spelled out in full — a DID is not skimmable, and approving the
    // wrong one is not something the user can see afterwards.
    {
      type: '$if',
      props: {
        condition: { $eq: [{ $store: 'runtimeStore.pendingConsent.kind' }, 'trust'] },
        then: {
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'body' },
              children: [{ $store: 'runtimeStore.pendingConsent.message' }],
            },
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted', styles: { 'word-break': 'break-all' } },
              children: [{ $store: 'runtimeStore.pendingConsent.peerId' }],
            },
          ],
        },
      },
    },
  ],
  cancelLabel: 'Deny',
  confirmLabel: 'Approve',
  busy: { $store: 'runtimeStore.loading' },
  confirm: { $action: 'runtimeStore.approveConsent' },
});

/**
 * The code an approved capability request returns, which the user reads back to the asking app.
 *
 * Separate from the prompt above because it outlives it: the prompt closes on approval and this
 * appears in its place. Folding them into one node would mean the dialog had two mutually
 * exclusive bodies and a button row that meant different things in each.
 */
export const consentSecret: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'runtimeStore.consentSecret' },
    then: {
      /*
        Hand-written rather than a fragment: it has one button and nothing to confirm, so it is
        neither a `confirmModal` nor a `formModal`, and a third fragment for a single call site is
        vocabulary noise. It is a real `we-modal` now, though — like the prompt above, it used to be
        a fixed Column over a literal black, which put the one dialog holding a code the user has to
        read outside the top layer and out of reach of the keyboard.
      */
      type: 'we-modal',
      props: { size: 'sm', ax: 'center', close: { $action: 'runtimeStore.dismissConsentSecret' } },
      children: [
        { type: 'we-icon', props: { name: 'key', color: 'accent-text', size: 'lg' } },
        { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Confirmation code'] },
        {
          type: 'we-text',
          props: { variant: 'body', color: 'text-muted', textAlign: 'center' },
          children: ['Enter this code in the app that requested access.'],
        },
        {
          type: 'we-text',
          props: {
            variant: 'heading-md',
            fontFamily: 'monospace',
            letterSpacing: 'wider',
            styles: { 'user-select': 'all' },
          },
          children: [{ $store: 'runtimeStore.consentSecret' }],
        },
        {
          type: 'we-button',
          props: { variant: 'primary', onClick: { $action: 'runtimeStore.dismissConsentSecret' } },
          children: ['Done'],
        },
      ],
    },
  },
};
