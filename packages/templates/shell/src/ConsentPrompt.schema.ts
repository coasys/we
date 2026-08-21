import type { SchemaNode } from '@we/schema-shared';

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
export const consentPrompt: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'runtimeStore.pendingConsent' },
    enterTransition: { type: 'fade', duration: 150 },
    then: {
      type: 'Column',
      props: {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        ax: 'center',
        ay: 'center',
        bg: 'rgba(0,0,0,0.5)',
        zIndex: 9998,
      },
      children: [
        {
          type: 'Column',
          props: { bg: 'surface', r: '400', p: '600', gap: '400', maxWidth: '420px', shadow: 'xl' },
          children: [
            // Heading — the backend's own title, so a request type we don't specifically
            // recognise still says something true rather than nothing.
            {
              type: 'Row',
              props: { gap: '300', ay: 'center' },
              children: [
                { type: 'we-icon', props: { name: 'shield-check', color: 'accent-strong' } },
                {
                  type: 'we-text',
                  props: { variant: 'heading-sm' },
                  children: [{ $store: 'runtimeStore.pendingConsent.title' }],
                },
              ],
            },

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

            // Trust requests: which peer, spelled out in full — a DID is not skimmable, and
            // approving the wrong one is not something the user can see afterwards.
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
                      props: {
                        variant: 'footnote',
                        color: 'text-muted',
                        styles: { 'word-break': 'break-all' },
                      },
                      children: [{ $store: 'runtimeStore.pendingConsent.peerId' }],
                    },
                  ],
                },
              },
            },

            {
              type: 'Row',
              props: { gap: '300', ax: 'end', mt: '200' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    text: 'Deny',
                    variant: 'ghost',
                    onClick: { $action: 'runtimeStore.denyConsent' },
                  },
                },
                {
                  type: 'we-button',
                  props: {
                    text: 'Approve',
                    color: 'accent-text',
                    bg: 'accent',
                    loading: { $store: 'runtimeStore.loading' },
                    onClick: { $action: 'runtimeStore.approveConsent' },
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
    enterTransition: { type: 'fade', duration: 150 },
    then: {
      type: 'Column',
      props: {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        ax: 'center',
        ay: 'center',
        bg: 'rgba(0,0,0,0.5)',
        zIndex: 9998,
      },
      children: [
        {
          type: 'Column',
          props: { bg: 'surface', r: '400', p: '600', gap: '400', maxWidth: '420px', shadow: 'xl', ax: 'center' },
          children: [
            { type: 'we-icon', props: { name: 'key', color: 'accent-strong', size: 'lg' } },
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
              props: {
                text: 'Done',
                color: 'accent-text',
                bg: 'accent',
                onClick: { $action: 'runtimeStore.dismissConsentSecret' },
              },
            },
          ],
        },
      ],
    },
  },
};
