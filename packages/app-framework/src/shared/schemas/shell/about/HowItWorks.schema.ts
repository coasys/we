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

function blockTypeRow(name: string, purpose: string) {
  return {
    type: 'Row',
    props: { gap: '400', ay: 'start', py: '200', borderBottom: '1px solid var(--we-color-neutral-200)' },
    children: [
      {
        type: 'we-text',
        props: {
          fontSize: '400',
          fontWeight: 'semibold',
          color: 'neutral-800',
          width: '180px',
          flexShrink: '0',
          fontFamily: 'mono',
        },
        children: [name],
      },
      {
        type: 'we-text',
        props: { fontSize: '400', color: 'neutral-600' },
        children: [purpose],
      },
    ],
  };
}

const BLOCK_TYPES = [
  ['TextBlock', 'Paragraphs, headings, lists, quotes, code'],
  ['ImageBlock', 'Photos, diagrams, artwork'],
  ['AudioBlock', 'Music, podcasts, voice memos'],
  ['VideoBlock', 'Clips, streams, tutorials'],
  ['FileBlock', 'Documents, binary files'],
  ['CodeBlock', 'Source code, config'],
  ['TableBlock', 'Data tables, spreadsheets'],
  ['ChecklistBlock', 'Todo items, ingredient lists'],
  ['MapBlock', 'Locations, routes'],
  ['CalendarBlock', 'Events, schedules'],
  ['PollBlock', 'Polls, votes, surveys'],
  ['CollectionBlock', 'Playlists, albums, folders, galleries'],
  ['LinkBlock', 'Bookmarks, previews'],
  ['EmbedBlock', 'External content'],
];

export const howItWorksTemplate: TemplateSchema = {
  meta: { name: 'How It Works', description: 'The architecture behind WE', icon: 'blueprint' },
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
          children: [heading('A shared vocabulary for community software.')],
        },

        // ── Data/interface separation ─────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            heading('The core insight: separate data from interface'),
            body(
              "Most social software bundles data and interface together inseparably. Your posts live inside the app. The app's logic decides how to display them, who can see them, what you can do with them. Switch apps and you start over.",
            ),
            body(
              'WE takes a different approach: data and interface are explicitly separated. Your data lives in your own AD4M perspective. Experiences in WE are lenses over that data — different ways of viewing, interacting with, and organising the same underlying information.',
            ),
            body(
              'Install a new experience and it reads your existing data. Uninstall one and nothing is lost. The interface is not the data. It is just one way of seeing it.',
            ),
          ],
        },

        // ── Block system ──────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '400' },
          children: [
            heading('The block system: a shared content vocabulary'),
            body(
              "One of the core problems in building social tools is fragmentation at the content level. If every community generates its own schema for a music track, a post, a calendar event, or a resource offer, you end up with thousands of incompatible structures representing the same things. Cross-community sharing becomes essentially impossible — not because the data doesn't exist, but because no one agreed on what to call it.",
            ),
            body(
              'WE resolves this with a shared block system: a standardised set of content primitives that every experience can read and render.',
            ),
            {
              type: 'Column',
              props: {
                r: 'lg',
                bg: 'neutral-100',
                border: '1px solid var(--we-color-neutral-200)',
                overflow: 'hidden',
              },
              children: BLOCK_TYPES.map(([name, purpose]) => blockTypeRow(name, purpose)),
            },
            body(
              'Think of these as the alphabet. The alphabet is fixed. The sentences are free. Any community can compose these blocks into any structure. New block types can be contributed to extend what every community can express — without breaking anything that already exists.',
            ),
          ],
        },

        // ── Templates as schemas ──────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '400', p: '600', r: 'lg', bg: 'neutral-100', border: '1px solid var(--we-color-neutral-200)' },
          children: [
            heading('Templates: experiences as schemas'),
            body(
              'Every experience in WE is defined as a JSON schema — a structured, human-readable description of which components to include, how they are laid out, how they are styled, and what interactions are possible.',
            ),
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    subheading('Inspectable'),
                    body(
                      'You can read a template and understand exactly what it does before running it. No hidden logic, no black-box behaviours.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    subheading('Forkable'),
                    body(
                      'Copy a template, change what you need, publish the fork. The original is unaffected. Yours immediately has a working base.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    subheading('AI-readable'),
                    body(
                      'Language models can parse, reason about, and generate valid schemas. AI can help communities customise their environment from natural language — not by writing code, but by working in the same structured format the system already speaks. This works today, including for communities whose data comes from AD4M perspectives created by entirely different tools.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    subheading('Framework-agnostic'),
                    body(
                      'The schema specification is not tied to any single frontend framework. Solid is the current default renderer, but the architecture is open to others.',
                    ),
                  ],
                },
              ],
            },
          ],
        },

        // ── Signalling system ─────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            heading('The signalling system'),
            body(
              'Communities don\'t all surface information the same way, and a generic "like" or "upvote" flattens nuance that matters.',
            ),
            body(
              "WE's signalling system lets communities define their own signal types — what counts as relevant, urgent, well-crafted, or worth amplifying in their specific context. Signals are first-class objects in the system: they can be attached to any content, queried by experiences, and used to shape how information surfaces.",
            ),
            body(
              'A research community might signal for epistemic confidence and novelty. A mutual aid network might signal for urgency and capacity to help. A creative collective might signal for craft and resonance. Each community defines what attention means for them.',
            ),
          ],
        },

        // ── AD4M foundation ───────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '400' },
          children: [
            heading('The AD4M foundation'),
            body('Everything in WE sits on AD4M — the Agent-Centric Distributed Application Meta-protocol.'),
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    subheading('Sovereign identity'),
                    body(
                      'Every agent has a persistent, self-owned identity that works across communities and experiences. Your profile, relationships, and reputation are not locked inside any single app.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    subheading('Agent-centric data'),
                    body(
                      'Your data lives in your own AD4M perspective — a personal graph of everything connected to your identity. No central server owns it.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    subheading('Peer-to-peer coordination'),
                    body("Communities can operate without depending on any platform's servers."),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    subheading('Semantic interoperability'),
                    body(
                      'A shared predicate vocabulary means content created by entirely different tools can be understood and rendered by WE without prior coordination between builders.',
                    ),
                  ],
                },
              ],
            },
          ],
        },

        // ── Meta-app rationale ────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            heading('Why a meta-app, not many separate apps'),
            body(
              'A natural question: if AD4M makes decentralised apps possible, why not just build lots of separate apps on AD4M?',
            ),
            body(
              'Separate apps recover sovereignty at the infrastructure layer but recreate fragmentation at the experience layer. Each app still rebuilds its own components from scratch, fractures identity and data across separate contexts, and resets innovation at its own boundary.',
            ),
            body(
              'WE provides a shared experiential layer on top of AD4M. Components and templates improve the whole ecosystem, not just one isolated product. Innovation compounds instead of resetting per app. Communities evolve without repeatedly starting from zero.',
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
                text: 'See it in practice →',
                variant: 'ghost',
                onClick: { $action: 'templateStore.openShellView', args: ['see-it-in-practice'] },
              },
            },
          ],
        },
      ],
    },
  ],
};
