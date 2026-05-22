import type { TemplateSchema } from '@we/schema-shared';

function heading(text: string) {
  return {
    type: 'we-text',
    props: { fontSize: '700', fontWeight: 'bold', color: 'neutral-900', lineHeight: '1.3' },
    children: [text],
  };
}

function subheading(text: string) {
  return {
    type: 'we-text',
    props: { fontSize: '600', fontWeight: 'semibold', color: 'neutral-900' },
    children: [text],
  };
}

function body(text: string, italic = false) {
  return {
    type: 'we-text',
    props: {
      fontSize: '500',
      color: 'neutral-700',
      lineHeight: '1.7',
      ...(italic ? { fontStyle: 'italic' } : {}),
    },
    children: [text],
  };
}

function bulletItem(text: string) {
  return {
    type: 'Row',
    props: { gap: '300', ay: 'start' },
    children: [
      { type: 'we-text', props: { fontSize: '500', color: 'neutral-400', mt: '50' }, children: ['—'] },
      { type: 'we-text', props: { fontSize: '500', color: 'neutral-700', lineHeight: '1.6' }, children: [text] },
    ],
  };
}

export const forCommunitiesTemplate: TemplateSchema = {
  meta: { name: 'For Communities', description: 'How WE serves communities', icon: 'users' },
  type: 'Column',
  props: { width: '100%', minHeight: '100%', bg: 'neutral-50', ax: 'center' },
  children: [
    {
      type: 'Column',
      props: { px: '500', py: '800', gap: '700', maxWidth: '800px', width: '100%' },
      children: [
        // ── Back nav ──────────────────────────────────────────────────────
        {
          type: 'Row',
          props: { ay: 'center', gap: '200' },
          children: [
            {
              type: 'we-button',
              props: {
                text: 'Back',
                variant: 'ghost',
                size: 'sm',
                iconLeft: 'arrow-left',
                onClick: { $action: 'templateStore.openShellView', args: ['landing-page'] },
              },
            },
          ],
        },

        // ── Heading ───────────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            heading('Tools that belong to your community, not a platform.'),
            body(
              'Most digital communities today are socially alive but structurally constrained. You can shape your culture, your tone, your norms. But the deeper layer — the software conditions you actually live inside — is almost always fixed by someone else.',
            ),
          ],
        },

        // ── Fixed list ────────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '200', pl: '200' },
          children: [
            bulletItem('The feed logic is fixed.'),
            bulletItem('The governance model is fixed.'),
            bulletItem('The moderation tools are fixed.'),
            bulletItem('The interface is fixed.'),
            bulletItem('What counts as a signal is fixed.'),
          ],
        },

        body(
          "Even when a platform offers plugins or admin controls, you're still customising within a house you don't own. The foundations belong to someone else. And when their incentives shift — and they always do — you pay the price.",
        ),
        body('WE is built differently.'),

        // ── What WE makes possible ────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '500' },
          children: [
            heading('What WE makes possible'),

            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                subheading('Your data, your history'),
                body(
                  'Everything your community creates lives in decentralised infrastructure you control, powered by the AD4M protocol. No central server to shut down. No platform to hold your history hostage. Uninstall an experience and your data stays. Switch to a different interface and your entire history comes with you.',
                ),
                body(
                  'One persistent, portable identity moves with you across every experience inside WE — and across communities. Your reputation, your connections, your context: yours.',
                ),
              ],
            },

            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                subheading('Tools that grow with you'),
                body(
                  "WE experiences are built from structured templates — not locked code. Start from a template that fits your community today, adapt it as your needs change. Adjust how information surfaces. Define what kinds of signals matter in your context. Fork an experience that's mostly right and change the parts that aren't.",
                ),
                body(
                  "You don't need to migrate to a new platform to do this. You don't lose your history when you change.",
                ),
              ],
            },

            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                subheading('Your coordination in one place'),
                body(
                  "Discussion, shared knowledge, resource coordination, community signals — these don't have to live in separate apps. In WE, they coexist in one environment under one identity. Context doesn't get lost between tools because there's no gap to lose it in.",
                ),
              ],
            },

            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                subheading('Design signals that mean something to your community'),
                body(
                  "WE's signalling system lets communities define their own signal types — what counts as important, relevant, urgent, or well-crafted — rather than accepting the platform's one-size-fits-all defaults. Your community's values shape how attention flows.",
                ),
              ],
            },

            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                subheading('Learn from others, contribute back'),
                body(
                  "When another community builds something better, that pattern can be published and adopted. WE's growing marketplace is designed to let useful coordination patterns spread — not stay locked inside the group that discovered them. Your community's discoveries can improve the ecosystem too.",
                ),
              ],
            },
          ],
        },

        // ── In practice ───────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '400', p: '600', r: 'lg', bg: 'neutral-100', border: '1px solid var(--we-color-neutral-200)' },
          children: [
            heading('What this looks like in practice'),
            body(
              'A local collective starts with a simple discussion and resource-sharing template. As the community grows, members want clearer ways to surface urgent needs and signal collective support. They use WE\'s signalling system to define exactly what those signals mean for their context — not repurposing a generic "like" button but creating something that carries real meaning for their culture.',
            ),
            body(
              'A learning community builds not just a forum but an evolving knowledge environment — structured notes, linked concepts, multiple views over the same shared knowledge base. Newcomers see guided pathways. Experts see denser, more interconnected maps. Both are lenses over the same underlying data.',
            ),
            body(
              'A neighbourhood group brings together discussion, local coordination, resource offers and needs, and a shared calendar — all in one environment, all connected by the same identity and memory.',
            ),
          ],
        },

        // ── Deeper point ──────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            heading('The deeper point'),
            body('WE starts from a simple conviction:'),
            body(
              'Communities should be able to evolve not just what they say, but the interfaces, incentives, and institutions through which they relate.',
              true,
            ),
            body(
              'That means more agency over digital tools, more continuity of history and identity, and more room for communities to discover forms of organisation that actually fit who they are.',
            ),
          ],
        },

        // ── Nav buttons ───────────────────────────────────────────────────
        {
          type: 'Row',
          props: { gap: '300', wrap: true },
          children: [
            {
              type: 'we-button',
              props: {
                text: 'Back to overview',
                variant: 'secondary',
                onClick: { $action: 'templateStore.openShellView', args: ['landing-page'] },
              },
            },
            {
              type: 'we-button',
              props: {
                text: 'For builders →',
                variant: 'ghost',
                onClick: { $action: 'templateStore.openShellView', args: ['for-builders'] },
              },
            },
          ],
        },
      ],
    },
  ],
};
