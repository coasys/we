import type { TemplateSchema } from '@we/schema-shared';

/**
 * Landing Page — Shell template that pitches WE to newcomers.
 *
 * Accessible via clicking the WE logo in the sidebar header.
 * Uses FlipCard components (tap to reveal solution back).
 */

const CARDS = [
  {
    front: {
      icon: 'lock-key',
      title: "You're stuck renting your own community.",
      body: "Every group chat or shared workspace lives on someone else's land. One day they change the rules, raise prices, or shut down — and your entire history and hard-earned culture can vanish overnight.",
    },
    back: {
      icon: 'vault',
      body: 'In WE, your community owns everything. Data lives in decentralised infrastructure you control. Uninstall an experience and your data stays. Move tools and your history comes with you.',
    },
  },
  {
    front: {
      icon: 'arrows-split',
      title: 'Everything is scattered across too many apps.',
      body: "Your group already juggles Slack + Docs + WhatsApp + a voting tool + a calendar. Every new need means 'add another app.' Context gets lost, people get exhausted, and half the group stops checking everything.",
    },
    back: {
      icon: 'squares-four',
      body: "WE is one environment where discussion, governance, shared knowledge, and economic coordination all live together and work together — under one identity. A community doesn't bolt on another tool. It evolves its environment.",
    },
  },
  {
    front: {
      icon: 'lock-simple',
      title: "You can't actually change the tools you use every day.",
      body: "You're allowed to pick a theme or add a bot, but the real decisions — how votes work, what feedback signals mean, how information surfaces — are locked by the developers. Your culture gets flattened to fit their tool.",
    },
    back: {
      icon: 'git-fork',
      body: 'In WE, every experience is built from structured templates — not locked code — that anyone can inspect, adapt, and share. Define what signals mean for your community. Fork an experience, make it yours, publish it back.',
    },
  },
  {
    front: {
      icon: 'translate',
      title: 'Every community is building in a different language.',
      body: 'As AI makes it easy to generate custom tools on demand, a hidden problem emerges: everyone ends up with incompatible versions of the same things. Flexibility and interoperability end up in opposition.',
    },
    back: {
      icon: 'intersect',
      body: "WE uses a shared vocabulary of content building blocks — text, audio, image, video, and more — that stay consistent across every community. Any community can connect with another's content without any upfront coordination. The alphabet is fixed. The sentences are free.",
    },
  },
  {
    front: {
      icon: 'plant',
      title: 'The tools break when your group grows.',
      body: 'What works great for 20 people becomes chaos at 200. You outgrow the simple tools but switching means losing years of history and starting over. So you suffer with tools that no longer fit.',
    },
    back: {
      icon: 'stack',
      body: "Because WE separates data from interface, evolving your tools doesn't mean losing your history. Adopt a new governance mechanism, swap in a better decision-making flow — the community's memory stays intact. The tools change. The community continues.",
    },
  },
  {
    front: {
      icon: 'robot',
      title: 'AI is just a chatbot on the side.',
      body: "Today's AI can describe changes and suggest features — but it's structurally outside the product. It can't reshape your interface or modify your governance logic. Locked software makes AI a very expensive suggestion box.",
    },
    back: {
      icon: 'magic-wand',
      body: 'WE is designed to be an environment AI can actively work inside. Experiences have a structure it can read, reason about, and modify. Describe what your community needs — a fairer decision-making process, a new economic flow — and AI can generate and preview it.',
    },
  },
  {
    front: {
      icon: 'share-network',
      title: 'Great ideas stay trapped inside single groups.',
      body: 'One community figures out a brilliant way to run proposals or share resources. But that discovery never escapes the group it was built inside. Every community keeps reinventing the same wheels.',
    },
    back: {
      icon: 'storefront',
      body: 'The WE marketplace distributes coordination patterns as reusable, forkable components — governance mechanisms, knowledge interfaces, signalling systems. A community that builds something better publishes it. Others adopt and improve it. The ecosystem learns.',
    },
  },
];

export const landingPageTemplate: TemplateSchema = {
  meta: { name: 'About WE', description: 'What WE is and why it exists', icon: 'info' },
  type: 'Column',
  props: { width: '100%', minHeight: '100%', bg: 'neutral-50', ax: 'center' },
  children: [
    // Scrollable content container
    {
      type: 'Column',
      props: { px: '500', py: '800', gap: '800', maxWidth: '1100px', width: '100%' },
      children: [
        // ── Hero ──────────────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '400', ax: 'center', ay: 'center' },
          children: [
            { type: 'WeCube', props: { width: '350px', height: '350px', rotationSpeed: 0.2, variant: 'wireframe' } },
            // {
            //   type: 'we-image',
            //   props: {
            //     src: '/we-text.svg',
            //     alt: 'WE',
            //     width: '60px',
            //     height: '60px',
            //     gradient: 'var(--we-gradient-primary)',
            //   },
            // },
            {
              type: 'we-text',
              props: { fontSize: '900', fontWeight: 'bold', color: 'neutral-900', textAlign: 'center' },
              children: ['The social layer humanity needs'],
            },
            {
              type: 'we-text',
              props: { fontSize: '600', color: 'neutral-700', textAlign: 'center' },
              children: [
                "Scattered across the planet are the insights and capacity to solve the hardest problems we face. But we're held back by social infrastructure built to extract from us, not evolve with us — locked tools, fragmented context, coordination systems no one can change.",
              ],
            },
            {
              type: 'we-text',
              props: { fontSize: '600', color: 'neutral-700', textAlign: 'center' },
              children: [
                'WE offers communities a foundation to reclaim their infrastructure, reshape their tools, and an open ecosystem where better forms of governance and coordination can emerge and spread.',
              ],
            },
          ],
        },

        // ── Section label ─────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '200', ax: 'center' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '400', color: 'neutral-500', textAlign: 'center' },
              children: ['Tap a card to see the solution'],
            },
          ],
        },

        // ── Card grid ─────────────────────────────────────────────────────
        {
          type: 'Row',
          props: { wrap: true, ax: 'center', gap: '400' },
          children: CARDS.map((card) => ({
            type: 'FlipCard',
            props: { width: '340px', height: '310px', wobbleDegree: 20 },
            slots: {
              front: {
                type: 'Column',
                props: {
                  gap: '300',
                  p: '500',
                  r: '400',
                  bg: 'neutral-100',
                  height: '100%',
                  border: '1px solid var(--we-color-neutral-200)',
                },
                children: [
                  { type: 'we-icon', props: { name: card.front.icon, size: 'xl', color: 'primary-500' } },
                  {
                    type: 'we-text',
                    props: {
                      fontSize: '600',
                      fontWeight: 'semibold',
                      textAlign: 'center',
                      color: 'neutral-900',
                      lineHeight: '1.4',
                    },
                    children: [card.front.title],
                  },
                  {
                    type: 'we-text',
                    props: { fontSize: '400', textAlign: 'center', color: 'neutral-600', lineHeight: '1.6' },
                    children: [card.front.body],
                  },
                ],
              },
              back: {
                type: 'Column',
                props: {
                  gap: '300',
                  p: '500',
                  r: '400',
                  ay: 'center',
                  bg: 'gradient-primary',
                  height: '100%',
                },
                children: [
                  { type: 'we-icon', props: { name: card.back.icon, size: 'xl', color: 'primary-100' } },
                  {
                    type: 'we-text',
                    props: { lineHeight: '1.6', fontSize: '400', color: 'primary-100' },
                    children: [card.back.body],
                  },
                ],
              },
            },
          })),
        },

        // ── Closing statement ─────────────────────────────────────────────
        {
          type: 'Column',
          props: {
            gap: '400',
            p: '700',
            r: 'lg',
            bg: 'neutral-100',
            border: '1px solid var(--we-color-neutral-200)',
          },
          children: [
            {
              type: 'we-text',
              props: { tag: 'h2', fontSize: '700', fontWeight: 'bold', color: 'neutral-900' },
              children: ['What this adds up to'],
            },
            {
              type: 'we-text',
              props: { fontSize: '500', color: 'neutral-700', lineHeight: '1.7' },
              children: [
                'Most communities today are socially alive but structurally constrained — capable of growing, creating, and self-organising, but unable to evolve the software conditions they live inside.',
              ],
            },
            {
              type: 'we-text',
              props: { fontSize: '500', color: 'neutral-700', lineHeight: '1.7' },
              children: [
                'WE is an attempt to change that. Not by building a better platform, but by giving communities a shared environment where the tools themselves become something that can be owned, shaped, and passed on.',
              ],
            },
            {
              type: 'we-text',
              props: {
                fontSize: '500',
                color: 'neutral-700',
                fontWeight: 'medium',
                lineHeight: '1.7',
                fontStyle: 'italic',
              },
              children: [
                'The deeper bet: given the right infrastructure, communities will discover forms of coordination and collective intelligence that no platform team would have designed for them. And those discoveries will spread.',
              ],
            },
          ],
        },

        // ── Back button ───────────────────────────────────────────────────
        {
          type: 'Row',
          props: { ax: 'center' },
          children: [
            {
              type: 'we-button',
              props: {
                text: 'Back to home',
                variant: 'secondary',
                onClick: { $action: 'templateStore.switchTemplate', args: ['default'] },
              },
            },
          ],
        },
      ],
    },
  ],
};
