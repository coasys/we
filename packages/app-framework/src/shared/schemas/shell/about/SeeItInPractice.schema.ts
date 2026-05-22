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

function body(text: string) {
  return {
    type: 'we-text',
    props: { fontSize: '500', color: 'neutral-700', lineHeight: '1.7' },
    children: [text],
  };
}

function bulletItem(text: string) {
  return {
    type: 'Row',
    props: { gap: '300', ay: 'start' },
    children: [
      {
        type: 'we-text',
        props: { fontSize: '500', color: 'primary-500', fontWeight: 'bold', flexShrink: '0' },
        children: ['→'],
      },
      {
        type: 'we-text',
        props: { fontSize: '500', color: 'neutral-700', lineHeight: '1.7' },
        children: [text],
      },
    ],
  };
}

function exampleCard(title: string, description: string, bullets: string[]) {
  return {
    type: 'Column',
    props: { gap: '400', p: '600', r: 'lg', bg: 'white', border: '1px solid var(--we-color-neutral-200)' },
    children: [
      subheading(title),
      body(description),
      ...(bullets.length > 0 ? [{ type: 'Column', props: { gap: '200' }, children: bullets.map(bulletItem) }] : []),
    ],
  };
}

export const seeItInPracticeTemplate: TemplateSchema = {
  meta: { name: 'See It In Practice', description: 'Real uses of WE communities', icon: 'magnifying-glass' },
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
        heading('What communities actually do with WE.'),

        // ── Intro ─────────────────────────────────────────────────────────
        body(
          'The best way to understand WE is not the architecture, but the habit it creates: when a community needs something, they describe it, and the system helps build it.',
        ),

        // ── Example 1: Research ───────────────────────────────────────────
        exampleCard(
          'A research collective',
          'A group of independent researchers is tired of losing context across email threads, shared docs, and citation managers. They set up a community in WE.',
          [
            'They fork a literature-review template and add a confidence-rating signal type specific to their methodology.',
            'Papers are annotated as blocks. Signals surface what the group collectively considers well-evidenced versus speculative.',
            'When a member leaves, they take their data. When a new member joins, they see the full annotated history.',
            'An AI assistant reads the schema and helps the group run structured debates over contested claims.',
          ],
        ),

        // ── Example 2: Mutual aid ─────────────────────────────────────────
        exampleCard(
          'A neighbourhood mutual aid network',
          "A local network needs to coordinate offers and requests across a community of several hundred people. They don't want to depend on a third-party app that might disappear.",
          [
            'They use an offer/request experience with custom urgency and capacity signals.',
            'Members can see who has what, who needs what, and what is being actively coordinated — all without ever exposing that data outside the group.',
            'A fork of the experience adds a skills directory and an event board. Both share the same identity layer: one member profile, no separate logins.',
          ],
        ),

        // ── Example 3: Creative collective ───────────────────────────────
        exampleCard(
          'A creative collective',
          'A distributed group of musicians, visual artists, and writers want a shared creative environment that feels genuinely theirs.',
          [
            'They build a custom portfolio experience using ImageBlock, AudioBlock, and TextBlock.',
            'They add a signal type for collaborative resonance — a way of saying "this connects with what I\'m making" rather than just a generic like.',
            'When a member develops a residency context with a different community, they can install that template without disrupting their home environment.',
          ],
        ),

        // ── Example 4: Open-source project ───────────────────────────────
        exampleCard(
          'An open-source project community',
          "The project's developer community wants better coordination between their issue tracker, documentation, and async decision-making processes.",
          [
            'They configure a community with linked experiences for proposals, structured discussions, and technical documentation.',
            'Proposals use a custom signal type that tracks endorsement, concern, and abstention separately.',
            'AI tools operate over the same schema the humans use — surfacing unresolved concerns, summarising discussion threads, and drafting documentation stubs.',
          ],
        ),

        // ── Example 5: Educational community ──────────────────────────────
        exampleCard(
          'An educational community',
          'A learning cooperative wants to build curriculum together, track member progress, and surface what is actually working.',
          [
            'Lessons are TextBlock and VideoBlock sequences, annotated with ChecklistBlock assessments.',
            'Signals track what members found genuinely useful versus what felt like padding.',
            'The community forks a module, adapts it to their context, and publishes the adaptation — giving it back to anyone else who might need it.',
          ],
        ),

        // ── Example 6: Governance coordination ───────────────────────────
        exampleCard(
          'A decentralised governance group',
          'A group making collective decisions across time zones and disciplines needs structured deliberation without the chaos of unthreaded chat.',
          [
            'They run a proposal template with defined phases: draft, discussion, amendment, and decision.',
            'Signals distinguish between support, concern, amendment suggestion, and blocking objection.',
            'Every decision has a legible history: what was proposed, what changed, why, and how the outcome was reached.',
          ],
        ),

        // ── The pattern underneath ─────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '400', p: '600', r: 'lg', bg: 'neutral-100', border: '1px solid var(--we-color-neutral-200)' },
          children: [
            heading('The pattern underneath'),
            body('Across all of these: the community owns their environment, not the platform.'),
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                bulletItem('Data does not leave when tools change.'),
                bulletItem('Templates are adapted, not rebuilt from scratch.'),
                bulletItem('Identity is persistent across every context.'),
                bulletItem('What one community builds is available to every community.'),
                bulletItem('AI works within the same structured layer that humans do.'),
              ],
            },
            body(
              'This is what cooperative infrastructure looks like in practice: not tools designed to capture communities, but tools communities genuinely control.',
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
                text: 'Close',
                variant: 'ghost',
                onClick: { $action: 'templateStore.closeShellView' },
              },
            },
          ],
        },
      ],
    },
  ],
};
