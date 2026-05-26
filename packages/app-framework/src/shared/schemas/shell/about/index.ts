import type { TemplateSchema } from '@we/schema-shared';

import forBuildersV1 from '../../../assets/CTAv1/ForBuilders.jpg';
import forCommunitiesV1 from '../../../assets/CTAv1/ForCommunitiesLarge.jpg';
import howItWorksV1 from '../../../assets/CTAv1/HowItWorks.jpg';
import seeItInPracticeV1 from '../../../assets/CTAv1/SeeItInPractice.jpg';
import forBuildersV2 from '../../../assets/CTAv2/ForBuilders.jpg';
import forCommunitiesV2 from '../../../assets/CTAv2/ForCommunities.jpg';
import howItWorksV2 from '../../../assets/CTAv2/HowItWorks.jpg';
import seeItInPracticeV2 from '../../../assets/CTAv2/SeeItInPractice.jpg';

const IMAGE_SETS = {
  v1: {
    forCommunities: forCommunitiesV1,
    forBuilders: forBuildersV1,
    howItWorks: howItWorksV1,
    seeItInPractice: seeItInPracticeV1,
  },
  v2: {
    forCommunities: forCommunitiesV2,
    forBuilders: forBuildersV2,
    howItWorks: howItWorksV2,
    seeItInPractice: seeItInPracticeV2,
  },
} as const;

const IMAGES = IMAGE_SETS.v1; // ← toggle here

/**
 * About WE — Shell overlay that pitches WE to newcomers.
 *
 * Accessible via clicking the WE logo in the sidebar header.
 * Uses FlipCard components (tap to reveal back) + deep-dive signpost cards.
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sectionHeading(text: string) {
  return {
    type: 'we-text',
    props: { fontSize: '700', fontWeight: 'bold', color: 'neutral-900', mb: '100' },
    children: [text],
  };
}

function bodyText(text: string, italic = false) {
  return {
    type: 'we-text',
    props: {
      fontSize: '500',
      color: 'neutral-700',
      lineHeight: '1.7',
      ...(italic ? { italic: true, fontWeight: 'medium' } : {}),
    },
    children: [text],
  };
}

function subheading(text: string) {
  return {
    type: 'we-text',
    props: { fontSize: '600', fontWeight: 'bold', color: 'primary-900', mb: '300' },
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

function pageHeader(icon: string, label: string) {
  return {
    type: 'Row',
    props: { ay: 'center', gap: '400' },
    children: [
      { type: 'we-icon', props: { name: icon, size: 'lg', color: 'primary-600' } },
      {
        type: 'we-text',
        props: { fontSize: '700', fontWeight: 'bold', color: 'primary-600', textTransform: 'uppercase' },
        children: [label],
      },
    ],
  };
}

function sectionHeader(card: (typeof DEEP_DIVE)[0]) {
  return [
    pageHeader(card.icon, card.label),
    sectionHeading(card.title),
    {
      type: 'we-image',
      props: { src: card.image, alt: card.imageAlt, fit: 'cover', width: '100%', height: '300px' },
    },
  ];
}

// ─── Flip Cards ───────────────────────────────────────────────────────────────

const CARDS = [
  {
    front: {
      icon: 'castle-turret',
      title: "You're stuck renting your own community.",
      body: "Every group chat or shared workspace lives on someone else's land. One day they change the rules, raise prices, or shut down — and your entire history and culture can vanish overnight.",
    },
    back: {
      icon: 'house-line',
      title: 'Own your data. Protect your culture.',
      body: 'In WE, your community owns everything. Data lives in decentralised infrastructure you control. Change your interface and your data stays. Switch tools and your history comes with you.',
    },
  },
  {
    front: {
      icon: 'arrows-split',
      title: 'Everything is scattered across too many apps.',
      body: 'Your group juggles Slack, Docs, WhatsApp, a voting tool, a calendar. Every new need means another app. Context gets lost, people get exhausted, and half the group stops showing up.',
    },
    back: {
      icon: 'squares-four',
      title: 'Everything you need in one place.',
      body: 'WE is one environment where discussion, signals, shared knowledge, and coordination all live together — one place, one identity, no context-switching. When your community needs something new, it grows its environment instead of fragmenting it.',
    },
  },
  {
    front: {
      icon: 'lock-simple',
      title: "You can't change the tools you depend on.",
      body: 'You can pick a theme or add a bot, but the real decisions — how the interface is organised, how votes work, what signals mean — are locked by developers. Your culture gets flattened to fit their product.',
    },
    back: {
      icon: 'git-fork',
      title: 'Fork it, reshape it, make it yours.',
      body: 'In WE, every experience is built from structured templates anyone can inspect, adapt, and share. Define what signals mean for your community. Fork a tool, make it fit, publish it back for others.',
    },
  },
  {
    front: {
      icon: 'circles-three',
      title: 'Diversity crushed for compatibility.',
      body: "Different tools speak different languages. Data created in one community can't flow into another without conversion overhead, fragile integrations, or one side giving up the tool that actually fits them. To connect, someone has to conform.",
    },
    back: {
      icon: 'fediverse-logo',
      title: 'Unity without uniformity.',
      body: 'WE is built on a shared protocol any compatible tool can speak. Different communities using different experiences can still share data, connect, and collaborate — without anyone having to standardize. Your community keeps its way of working. Others keep theirs.',
    },
  },
  {
    front: {
      icon: 'hammer',
      title: 'Builders compete when they could compound.',
      body: "Every new app has to rebuild the same foundations before it can ship. Then it competes for users against other innovations that don't actually conflict. Good ideas stay isolated instead of building on each other.",
    },
    back: {
      icon: 'storefront',
      title: "Build what's new. Reuse what's already here.",
      body: "The shared foundations already exist. Start there, build what's new, and contribute it to a growing module marketplace. Others fork it, improve it, build on it. Compatible innovations don't compete — they compound.",
    },
  },
  {
    front: {
      icon: 'robot',
      title: "AI can suggest changes but can't make them.",
      body: "Today's AI can write code and describe features — but it's structurally locked outside the product. It can't reshape your interface or modify how your community works. It's advice you can't act on.",
    },
    back: {
      icon: 'magic-wand',
      title: 'AI that works inside your environment.',
      body: 'WE experiences are structured schemas AI can read, reason about, and generate. Describe what your community needs and AI can build and preview a template in place — working inside the environment, not beside it.',
    },
  },
];

// {
//   front: {
//     icon: 'translate',
//     title: 'Switching tools means losing your history.',
//     body: 'What works for 20 people breaks at 200. You outgrow your tools but switching means losing years of conversations, decisions, and context. So you stay stuck with something that no longer fits.',
//   },
//   back: {
//     icon: 'stack',
//     title: 'Evolve your tools. Keep your memory.',
//     body: "Because WE separates data from interface, upgrading your tools doesn't mean losing your history. Swap in a new template, redesign how information surfaces — the community's memory stays intact.",
//   },
// },

// ─── Deep Dive Cards ─────────────────────────────────────────────────────────

const DEEP_DIVE = [
  {
    id: 'for-communities',
    icon: 'users',
    label: 'For communities',
    title: 'Tools that adapt to your community, not the other way around.',
    preview:
      "Your community's tools should grow with you — not trap your data, resist change, or disappear when a platform pivots. WE gives you an environment you shape over time, with full continuity of history and identity.",
    image: IMAGES.forCommunities,
    imageAlt: 'Communities collaborating',
  },
  {
    id: 'for-builders',
    icon: 'hammer',
    label: 'For builders',
    title: "Build what's new. Reuse what's already here.",
    preview:
      'Identity, data infrastructure, a content system, a design system, a growing component library — already in the ecosystem. You start from those and build only what is genuinely new. Contribute it as a module and the whole ecosystem benefits, without competing for the same users.',
    image: IMAGES.forBuilders,
    imageAlt: 'Builders at work',
  },
  {
    id: 'how-it-works',
    icon: 'blueprint',
    label: 'How it works',
    title: 'A shared vocabulary for community software.',
    preview:
      'WE uses structured building blocks — composable, inspectable, and AI-readable. Experiences are schemas, not sealed code. That makes them forkable, malleable, and safe to share across the ecosystem.',
    image: IMAGES.howItWorks,
    imageAlt: 'System architecture',
  },
  {
    id: 'see-it-in-practice',
    icon: 'play',
    label: 'See it in practice',
    title: 'What communities actually do with WE.',
    preview:
      'A research collective that owns their annotation layer. A neighbourhood mutual aid network with no platform dependency. A creative collective that defines what resonance means for them.',
    image: IMAGES.seeItInPractice,
    imageAlt: 'Communities in action',
  },
];

function ctaCard(card: (typeof DEEP_DIVE)[0], imageLeft: boolean) {
  const imageCol = {
    type: 'Column',
    props: { flex: '0 0 45%', overflow: 'hidden' },
    children: [
      {
        type: 'we-image',
        props: { src: card.image, alt: card.imageAlt, fit: 'cover', width: '100%', height: '320px' },
      },
    ],
  };
  const contentCol = {
    type: 'Column',
    props: { p: '600', gap: '400', ay: 'center', ax: 'start' },
    children: [
      {
        type: 'Row',
        props: { ay: 'center', gap: '400' },
        children: [
          {
            type: 'we-icon',
            props: {
              name: card.icon,
              size: 'lg',
              color: 'primary-600',
              // gradient: 'primary',
            },
          }, // color: 'neutral-500'
          {
            type: 'we-text',
            props: {
              fontSize: '700',
              fontWeight: 'bold',
              // gradient: 'primary',
              // color: 'neutral-500',
              color: 'primary-600',
              textTransform: 'uppercase',
              // letterSpacing: '0.08em',
            },
            children: [card.label],
          },
        ],
      },
      {
        type: 'we-text',
        props: { fontSize: '600', fontWeight: 'bold', color: 'neutral-700', lineHeight: '1.3' },
        children: [card.title],
      },
      {
        type: 'we-text',
        props: { fontSize: '400', color: 'neutral-700', lineHeight: '1.7' },
        children: [card.preview],
      },
      {
        type: 'we-button',
        props: {
          text: 'Learn more',
          variant: 'outline',
          // gradient: true,
          // size: 'sm',
          onClick: { $action: 'templateStore.scrollToId', args: [card.id] },
        },
      },
    ],
  };
  return {
    type: 'Row',
    props: {
      r: '600',
      overflow: 'hidden',
      border: '1px solid var(--we-color-neutral-200)',
      width: '100%',
      bg: 'neutral-100',
    },
    children: imageLeft ? [imageCol, contentCol] : [contentCol, imageCol],
  };
}

// ─── Roadmap Items ────────────────────────────────────────────────────────────

const BUILT = [
  {
    title: 'AD4M integration',
    description: 'Sovereign identity, self-owned data, and peer-to-peer coordination — no central server required.',
  },
  {
    title: 'Design system',
    description:
      'A full suite of compatible tokens, themes, primitives, components, and widgets that can be used to build experiences.',
  },
  {
    title: 'Schema system',
    description:
      'Adaptable JSON blueprints that define how experiences look and behave — rendered live without recompiling, safe to share, easy for AI to inspect and reason about, and runs in any frontend framework.',
  },
  {
    title: 'Block system',
    description:
      'Composable building blocks for content generation — text, images, audio, video, events, tasks, and more — that can be combined freely, from a single message to a full document.',
  },
  {
    title: 'AI template generation',
    description:
      "AI that reads the semantic shape of your community's data and generates working interfaces from plain language — start fresh or fork an existing template, no code required.",
  },
  {
    title: 'Customisable signals',
    description: 'Communities can define their own signal types and attach meaning to content.',
  },
  { title: 'Sub-app integration', description: 'Existing AD4M applications (including Flux) can run inside WE.' },
];

const IN_PROGRESS = [
  {
    title: 'Marketplace',
    description: 'Discovery and publishing infrastructure for templates, widgets, and block types.',
  },
  { title: 'Governance modules', description: 'Structured proposal and decision-making tools.' },
  { title: 'Economics and resource coordination', description: 'Flows for managing shared resources and incentives.' },
];

function roadmapItem(item: { title: string; description: string }, done: boolean) {
  return {
    type: 'Row',
    props: {
      gap: '400',
      ay: 'center',
      r: '400',
      p: '400',
      bg: 'neutral-75',
      border: '1px solid var(--we-color-neutral-200)', //  done ? '1px solid var(--we-color-neutral-200)' : '2px dashed var(--we-color-neutral-400)',
    },
    children: [
      {
        type: 'we-icon',
        props: {
          name: done ? 'check' : 'circle-dashed',
          size: '30px',
          // color: done ? 'primary-500' : 'neutral-400',
          gradient: 'primary', // done ? 'primary' : undefined,
          weight: 'bold',
        },
      },
      {
        type: 'Column',
        props: { gap: '100' },
        children: [
          {
            type: 'we-text',
            props: {
              fontSize: '600',
              fontWeight: 'bold',
              color: 'neutral-800', // done ? 'neutral-800' : 'neutral-600',
              // lineHeight: '1.5',
            },
            children: [item.title],
          },
          {
            type: 'we-text',
            props: { fontSize: '500', color: 'neutral-600' },
            children: [item.description],
          },
        ],
      },
    ],
  };
}

// ─── Template ─────────────────────────────────────────────────────────────────

export const landingPageTemplate: TemplateSchema = {
  meta: { name: 'About WE', description: 'What WE is and why it exists', icon: 'info' },
  type: 'Column',
  props: { width: '100%', minHeight: '100%', bg: 'neutral-50', ax: 'center' },
  children: [
    {
      type: 'Column',
      props: { px: '500', py: '800', gap: '500', maxWidth: '1100px', width: '100%' },
      children: [
        // ── Hero ──────────────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '400', ax: 'center', mt: '100px', mb: '180px' },
          children: [
            { type: 'WeCube', props: { width: '350px', height: '350px' } },
            // {
            //   type: 'we-image',
            //   props: { src: '/we-text.svg', alt: 'WE Logo', width: '50px', height: '35px', gradient: 'primary' },
            // },
            {
              type: 'Column',
              props: { ax: 'center', mt: '300', mb: '500' },
              children: [
                {
                  type: 'we-text',
                  props: {
                    fontSize: '52px',
                    // fontFamily: 'boldonse',
                    fontWeight: 'bold',
                    color: 'neutral-900',
                    textAlign: 'center',
                    // lineHeight: '0.8',
                    // letterSpacing: '0.2em',
                    // textTransform: 'uppercase',
                  },
                  children: [
                    'Social ',
                    {
                      type: 'we-text',
                      props: {
                        inline: true,
                        gradient: 'primary',
                        fontWeight: 'bold',
                        fontSize: '52px',
                      },
                      children: ['infrastructure'],
                    },
                    // ' for',
                  ],
                },
                {
                  type: 'we-text',
                  props: {
                    // fontFamily: 'boldonse',
                    fontSize: '52px',
                    fontWeight: 'bold',
                    color: 'neutral-900',
                    textAlign: 'center',
                    // letterSpacing: '0.1em',
                    // textTransform: 'uppercase',
                  },
                  children: ['for a more cooperative world.'],
                  // children: ['for the living web'],
                },
              ],
            },
            // {
            //   type: 'Column',
            //   props: { ax: 'center', mb: '500' },
            //   children: [
            //     {
            //       type: 'we-text',
            //       props: { fontSize: '50px', fontWeight: 'bold', color: 'neutral-900', textAlign: 'center' },
            //       children: [
            //         'Social infrastructure for the ',
            //         {
            //           type: 'we-text',
            //           props: { inline: true, gradient: 'primary', fontWeight: 'bold', fontSize: '50px' },
            //           children: ['living web'],
            //         },
            //       ],
            //     },
            //   ],
            // },
            // {
            //   type: 'we-text',
            //   props: { fontSize: '50px', fontWeight: 'bold', color: 'neutral-900', textAlign: 'center' },
            //   children: ['An open environment for community-built interfaces.'],
            // },
            // {
            //   type: 'Column',
            //   children: [
            //     {
            //       type: 'we-text',
            //       props: { fontSize: '50px', fontWeight: 'bold', color: 'neutral-900', textAlign: 'center' },
            //       children: ['An open environment'],
            //     },
            //     {
            //       type: 'we-text',
            //       props: { fontSize: '50px', fontWeight: 'bold', color: 'neutral-900', textAlign: 'center' },
            //       children: ['for community-built interfaces.'],
            //     },
            //   ],
            // },
            // {
            //   type: 'we-text',
            //   props: { fontSize: '50px', fontWeight: 'bold', color: 'neutral-900', textAlign: 'center' },
            //   children: ['The interface layer for the living web'],
            // },
            {
              type: 'we-text',
              props: {
                fontSize: '28px',
                color: 'neutral-700',
                textAlign: 'center',
                fontWeight: 'medium',
                mb: '500',
                // italic: true,
                // fontStyle: 'italic',
              },
              // children: ["Communities don't just live in WE. They shape it."],
              // children: ['Most platforms give you a space to use. WE gives you an environment to shape'],
              // children: ['Own your data. Shape your environment. Share what you build.'],
              // children: ['Own your data. Shape your environment. Build the commons.'],
              children: ['Own your data. Shape your environment. Grow the commons.'],
              // children: ["Design your community's experience. Own what you build. Share what works."],
            },
            // {
            //   type: 'we-text',
            //   props: {
            //     fontSize: '700',
            //     color: 'neutral-700',
            //     textAlign: 'center',
            //     fontWeight: 'medium',
            //     mb: '500',
            //   },
            //   children: [
            //     'Own your ',
            //     { type: 'we-text', props: { inline: true, italic: true }, children: ['data'] },
            //     ' . Shape your ',
            //     { type: 'we-text', props: { inline: true, italic: true }, children: ['environment'] },
            //     ' . Share what you ',
            //     { type: 'we-text', props: { inline: true, italic: true }, children: ['build'] },
            //     '.',
            //   ],
            // },
            {
              type: 'we-text',
              props: {
                fontSize: '18px',
                color: 'neutral-700',
                textAlign: 'center',
                maxWidth: '800px',
                lineHeight: '1.8',
                italic: true,
              },
              // children: [
              //   'WE is an open environment where community experiences are defined as schemas — not sealed apps. Any interface can be inspected, forked, and adapted to your context. Your data lives separately from the interface, so changing experiences never means losing history. What one community builds, every community can use.',
              // ],
              // children: [
              //   'WE is open-source software where community experiences are open templates — inspectable, forkable, and owned by the people who use them. Your data lives separately from the interface, so your history stays intact no matter how your tools evolve.',
              // ],
              // children: [
              //   "We've grown used to platforms that own our data, control our interfaces, and capture the value communities create. WE is an open environment built on a different premise: communities design their own tools, own their data, and share what works with everyone.", // Fork what exists. Build what's missing. Let collective intelligence compound — without losing what makes each community distinctly itself.
              // ],
              // children: [
              //   "We've grown used to platforms that own our data, control our interfaces, and capture the value communities create. WE is different: communities design their own tools, own their data, and share what works with everyone.",
              // ],
              // children: [
              //   "Today's platforms own your data, dictate your interface, and lock out innovation. WE is different: mix modules from an open marketplace, design experiences your community actually needs, and own your infrastructure. What one community builds, every community can use. Fork it, remix it, share it back.",
              // ],
              // children: [
              //   "Most platforms are privately owned, opaquely governed, and built to extract — not evolve with the communities that use them. WE is an open environment where you compose your community's interface from shared modules, own your data infrastructure, and contribute back to a growing commons. What one community discovers, every community can use. Collective intelligence, without losing what makes each community distinctly itself.",
              // ],
              // children: [
              //   "We've grown used to platforms designed to extract from us, that dictate our interfaces, block innovation, and limit our potential. WE flips this script by providing a framework that allows communities to design their own tools, mix and match modules from an open ecosystem, and own their own infrastructure.",
              // ],
              // children: [
              //   "We've grown used to platforms that own our data, control our interfaces, and treat community software as a product sold back to us. WE is different: an open environment where communities design their own tools, own their infrastructure, and share what works with everyone.",
              // ],
              // children: [
              //   "We've grown used to platforms that harvest our data, dictate our interfaces, and block innovation that doesn't fit their extractive agenda. But it doesn’t have to be this way. WE offers an alternative: an open environment where communities can reclaim their infrastructure, customise their interfaces, mix and match the tools they need, and share the fruits of those experiments with others.",
              // ],
              // children: [
              //   "We've grown used to platforms that harvest our data, dictate our interfaces, and block innovations our communities need to thrive. WE is attempting something different — an open environment where communities can design their own experiences, own their infrastructure, and share what they discover with everyone else.",
              // ],
              // children: [
              //   'Most platforms are privately owned, opaquely governed, and structurally resistant to change. WE is an open environment built on a different premise — where communities compose their own interfaces from shared modules, own their data infrastructure, and contribute back to a growing commons.',
              // ],
              // children: [
              //   'Most platforms are rigid by design — they control your data, lock your interface, and treat your community as a product. WE is an open environment where you can compose experiences, own your infrastructure, and contribute back. What one community figures out, every community can use.',
              // ],
              // children: [
              //   'Communities are living systems — they grow, adapt, and discover forms of organisation no product team would design for them. WE provides the infrastructure to make that possible, and share what you learn with everyone who comes after.',
              // ],
              // children: [
              //   'Communities are living systems — they grow, adapt, and discover forms of organisation no product team would design for them. WE is the infrastructure that makes it possible — and a commons where what each community discovers can spread to everyone else.',
              // ],
              // children: [
              //   'Communities are living systems — they grow, adapt, and discover forms of organisation no product team would design for them. WE is the infrastructure that makes it possible — open, composable, and designed so what each community discovers can spread.',
              // ],
              // children: [
              //   'Communities are living systems — they grow, adapt, and discover forms of organisation no product team would design for them. Most tools prevent exactly that. WE is open, composable infrastructure that gets out of the way — build what your community needs, contribute to a growing commons, and stay interoperable with everyone else.',
              // ],
              // children: [
              //   'Communities are living systems — they grow, adapt, and discover forms of organisation no product team would design for them. Most tools prevent exactly that. WE is open, composable infrastructure that gets out of the way — build what your community needs, without sacrificing interoperability with everyone else.',
              // ],
              // children: [
              //   'Communities are living systems — they grow, adapt, and discover forms of organisation no product team would design for them. WE is open, composable infrastructure that gets out of the way — build what your community needs, contribute to the commons, without sacrificing interoperability with everyone else.',
              // ],
              children: [
                'Communities are living systems — they grow, adapt, and discover forms of organisation no product team would design for them. WE is open, composable infrastructure that gets out of the way — build what your community needs, and share what works with the commons.',
              ],
              // children: [
              //   "A community that can't shape its tools will eventually be shaped by them. WE is open, composable infrastructure that flips this: own your data, design your environment, and contribute what you learn to a commons every community can draw on.",
              // ],

              // Most communities today are capable of growing, creating, and self-organising — but unable to evolve the software conditions they live inside. The tools shape the community far more than the community can shape the tools.

              // WE is an attempt to change that. Not by building a better platform, but by giving communities a shared environment where the tools themselves can be forked, adapted, and passed on.
            },
          ],
        },

        // ── Card section label ────────────────────────────────────────────
        {
          type: 'Column',
          props: { ax: 'center', gap: '300', mb: '400' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '700', fontWeight: 'bold', color: 'neutral-800', textAlign: 'center' },
              // children: ['Whats wrong with todays tools and how can we fix them?'],
              // children: ['What makes WE different'],
              children: ['The walls every community keeps hitting.'],
              // children: ['6 Problems. 6 Solutions'],
            },
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '600', color: 'neutral-600', textAlign: 'center' },
                  children: ['Tap a card to see the solution'],
                },
                {
                  type: 'we-icon',
                  props: { name: 'hand-pointing', size: '28px', color: 'neutral-400' },
                  // styles: { transform: 'rotate(180deg)' },
                },
                // { type: 'we-icon', props: { name: 'arrow-down', color: 'neutral-400' } },
              ],
            },
          ],
        },

        // ── Flip card grid ────────────────────────────────────────────────
        {
          type: 'Row',
          props: { wrap: true, ax: 'center', gap: '400', mb: '900' },
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
                  { type: 'we-icon', props: { name: card.front.icon, size: 'xl', gradient: 'primary' } },
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
                props: { gap: '300', p: '500', r: '400', ay: 'center', bg: 'gradient-primary', height: '100%' },
                children: [
                  { type: 'we-icon', props: { name: card.back.icon, size: 'xl', color: 'neutral-100' } },
                  {
                    type: 'we-text',
                    props: {
                      fontSize: '600',
                      fontWeight: '600',
                      textAlign: 'center',
                      color: 'neutral-100',
                      lineHeight: '1.4',
                    },
                    children: [card.back.title],
                  },
                  {
                    type: 'we-text',
                    props: { fontSize: '400', textAlign: 'center', color: 'neutral-100', lineHeight: '1.6' },
                    children: [card.back.body],
                  },
                ],
              },
            },
          })),
        },

        // ── Go deeper (full-width CTA cards) ─────────────────────────────
        {
          type: 'Column',
          props: { gap: '600', mt: '100px', mb: '180px' },
          children: [
            {
              type: 'Column',
              props: { gap: '300', ax: 'center' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '700', fontWeight: 'bold', color: 'neutral-900', textAlign: 'center' },
                  children: ['What this means for you.'],
                },
                // {
                //   type: 'Row',
                //   props: { gap: '200', ay: 'center' },
                //   children: [
                //     {
                //       type: 'we-text',
                //       props: { fontSize: '600', color: 'neutral-600', textAlign: 'center' },
                //       children: ['Click "learn more" on each card for a deeper dive'],
                //     },
                //     {
                //       type: 'we-icon',
                //       props: { name: 'hand-pointing', size: '28px', color: 'neutral-400' },
                //       // styles: { transform: 'rotate(180deg)' },
                //     },
                //     // { type: 'we-icon', props: { name: 'arrow-down', color: 'neutral-400' } },
                //   ],
                // },
                // {
                //   type: 'we-text',
                //   props: { fontSize: '500', color: 'neutral-600', textAlign: 'center' },
                //   children: ["WE means something different depending on where you're coming from."],
                // },
              ],
            },
            ...DEEP_DIVE.map((card, i) => {
              const imageLeft = i % 2 === 0;
              return {
                type: '$animate',
                props: {
                  scrollReveal: -100,
                  enterTransition: [
                    { type: 'fade', duration: 600, easing: 'ease-in-out' },
                    {
                      type: 'slide',
                      direction: imageLeft ? 'left' : 'right',
                      distance: '200px',
                      duration: 1000,
                      easing: 'ease-in-out',
                    },
                  ],
                },
                children: [ctaCard(card, imageLeft)],
              };
            }),
          ],
        },

        // {
        //   type: 'we-text',
        //   props: { fontSize: '700', fontWeight: 'bold', color: 'neutral-900', textAlign: 'center' },
        //   children: ['Learn more'],
        // },

        // ── Roadmap ───────────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '300', ax: 'center', mb: '300' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '700', fontWeight: 'bold', color: 'neutral-900', textAlign: 'center' },
              children: ["What we've built and what's next."],
            },
            {
              type: 'we-text',
              props: { fontSize: '600', color: 'neutral-600', textAlign: 'center' },
              children: ["WE is in active development. Here's an honest picture of where we're at."],
            },
          ],
        },
        {
          type: 'Column',
          props: { gap: '500', p: '700', r: '500', bg: 'neutral-100', border: '1px solid var(--we-color-neutral-200)' },
          children: [
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '400', ay: 'center', mb: '400' },
                  children: [
                    {
                      type: 'we-icon',
                      props: {
                        name: 'city',
                        size: 'lg',
                        color: 'primary-600',
                        // gradient: 'primary',
                      },
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '700', fontWeight: 'bold', color: 'primary-600', textTransform: 'uppercase' },
                      children: ['Already built'],
                    },
                  ],
                },
                ...BUILT.map((item) => roadmapItem(item, true)),
              ],
            },
          ],
        },
        {
          type: 'Column',
          props: { gap: '500', p: '700', r: '500', bg: 'neutral-100', border: '1px solid var(--we-color-neutral-200)' },
          children: [
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '400', ay: 'center', mb: '400' },
                  children: [
                    {
                      type: 'we-icon',
                      props: {
                        name: 'hourglass',
                        size: 'lg',
                        color: 'primary-600',
                        // gradient: 'primary',
                      },
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '700', fontWeight: 'bold', color: 'primary-600', textTransform: 'uppercase' },
                      children: ['In progress'],
                    },
                  ],
                },
                ...IN_PROGRESS.map((item) => roadmapItem(item, false)),
              ],
            },
            // {
            //   type: 'we-text',
            //   props: { fontSize: '500', fontWeight: 'semibold', color: 'neutral-700', fontStyle: 'italic' },
            //   children: ['The foundation is solid. The ecosystem is just beginning.'],
            // },
          ],
        },

        // ── For Communities ───────────────────────────────────────────────
        {
          type: 'Column',
          props: { id: 'for-communities', gap: '600', mt: '100px' },
          children: [
            ...sectionHeader(DEEP_DIVE[0]),
            bodyText(
              'Most digital communities today are socially alive but structurally constrained. You can shape your culture, your tone, your norms. But the deeper layer — the software conditions you actually live inside — is almost always fixed by someone else.',
            ),
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
            bodyText(
              "Even when a platform offers plugins or admin controls, you're still customising within a house you don't own. The foundations belong to someone else. And when their incentives shift — and they always do — you pay the price.",
            ),
            bodyText('WE is built differently.'),
            {
              type: 'Column',
              props: { gap: '600' },
              children: [
                // sectionHeading('What WE makes possible'),
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Your data, your history'),
                    bodyText(
                      'Everything your community creates lives in decentralised infrastructure you control, powered by the AD4M protocol. No central server to shut down. No platform to hold your history hostage. Uninstall an experience and your data stays. Switch to a different interface and your entire history comes with you.',
                    ),
                    bodyText(
                      'One persistent, portable identity moves with you across every experience inside WE — and across communities. Your reputation, your connections, your context: yours.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Tools that grow with you'),
                    bodyText(
                      "WE experiences are built from structured templates — not locked code. Start from a template that fits your community today, adapt it as your needs change. Adjust how information surfaces. Define what kinds of signals matter in your context. Fork an experience that's mostly right and change the parts that aren't.",
                    ),
                    bodyText(
                      "You don't need to migrate to a new platform to do this. You don't lose your history when you change.",
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Your coordination in one place'),
                    bodyText(
                      "Discussion, shared knowledge, resource coordination, community signals — these don't have to live in separate apps. In WE, they coexist in one environment under one identity. Context doesn't get lost between tools because there's no gap to lose it in.",
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Design signals that mean something to your community'),
                    bodyText(
                      "WE's signalling system lets communities define their own signal types — what counts as important, relevant, urgent, or well-crafted — rather than accepting the platform's one-size-fits-all defaults. Your community's values shape how attention flows.",
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Learn from others, contribute back'),
                    bodyText(
                      "When another community builds something better, that pattern can be published and adopted. WE's growing marketplace is designed to let useful coordination patterns spread — not stay locked inside the group that discovered them.",
                    ),
                  ],
                },
              ],
            },
            {
              type: 'Column',
              props: {
                gap: '400',
                p: '600',
                r: '500',
                bg: 'neutral-100',
                border: '1px solid var(--we-color-neutral-200)',
              },
              children: [
                sectionHeading('What this looks like in practice'),
                bodyText(
                  'A local collective starts with a simple discussion and resource-sharing template. As the community grows, members want clearer ways to surface urgent needs and signal collective support. They use WE\'s signalling system to define exactly what those signals mean for their context — not repurposing a generic "like" button but creating something that carries real meaning for their culture.',
                ),
                bodyText(
                  'A learning community builds not just a forum but an evolving knowledge environment — structured notes, linked concepts, multiple views over the same shared knowledge base. Newcomers see guided pathways. Experts see denser, more interconnected maps. Both are lenses over the same underlying data.',
                ),
                bodyText(
                  'A neighbourhood group brings together discussion, local coordination, resource offers and needs, and a shared calendar — all in one environment, all connected by the same identity and memory.',
                ),
              ],
            },
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                sectionHeading('The deeper point'),
                bodyText('WE starts from a simple conviction:'),
                bodyText(
                  'Communities should be able to evolve not just what they say, but the interfaces, incentives, and institutions through which they relate.',
                  true,
                ),
                bodyText(
                  'That means more agency over digital tools, more continuity of history and identity, and more room for communities to discover forms of organisation that actually fit who they are.',
                ),
              ],
            },
          ],
        },

        // ── For Builders ──────────────────────────────────────────────────
        {
          type: 'Column',
          props: { id: 'for-builders', gap: '600', pt: '800', borderTop: '2px solid var(--we-color-neutral-200)' },
          children: [
            ...sectionHeader(DEEP_DIVE[1]),
            bodyText(
              'Building a new social tool usually means building everything: identity, profiles, threads, feeds, moderation, content composition, data storage. None of that is the interesting part — it is just the price of entry before you can start on the thing that is actually new.',
            ),
            bodyText(
              'WE changes the starting point. Identity, data infrastructure, a content system, a design system, and a growing library of components and templates already exist in the ecosystem. You start from those and build only what is genuinely yours.',
            ),
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                sectionHeading("Contribute, don't compete"),
                bodyText(
                  'In a traditional app, your success depends on winning the adoption game — capturing users before someone else does. In WE, that pressure dissolves. Your contribution does not need to be a complete app to matter.',
                ),
                bodyText(
                  "A new widget, a block type, a template, a signalling pattern — each is a real addition to what every community in the ecosystem can use. A community can run your coordination module alongside someone else's knowledge base. Two experiences covering the same ground are not fighting for lock-in; they are both views over the same data, and users can run both.",
                ),
                bodyText(
                  "The question shifts from 'can I capture enough users to sustain this?' to 'does this new piece solve something real?' Good contributions spread through the ecosystem, get forked and improved, and come back better.",
                ),
              ],
            },
            {
              type: 'Column',
              props: { gap: '400' },
              children: [
                sectionHeading('What you can build'),
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Templates'),
                    bodyText(
                      'A template is a complete community environment defined as a JSON schema — which components to include, how they are laid out, how they are styled, what interactions are possible. Templates can be forked, remixed, and AI-generated.',
                    ),
                    bodyText(
                      'A community adopts your template, customises it to fit their context, and publishes their fork. The pattern evolves through real use rather than remaining frozen inside one product.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Widgets and components'),
                    bodyText(
                      'Reusable UI building blocks contributed to the shared ecosystem. Build once — available to every community and experience that wants them.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Block types'),
                    bodyText(
                      "WE's block system is the shared vocabulary for content. New block types can be contributed to extend what every community can compose and express — not just in your experience, but across the whole ecosystem.",
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Signalling systems'),
                    bodyText(
                      'Build reusable signalling patterns other communities can adopt and adapt. Each community then defines what those signals mean in their specific context.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Experiences'),
                    bodyText(
                      'Full environments — complete UIs and coordination stacks — that communities can install and run. Two music experiences are not fighting for lock-in; they are both views over the same library. Users can run both, and their data is never trapped.',
                    ),
                  ],
                },
              ],
            },
            {
              type: 'Column',
              props: {
                gap: '400',
                p: '600',
                r: 'lg',
                bg: 'neutral-100',
                border: '1px solid var(--we-color-neutral-200)',
              },
              children: [
                sectionHeading('Why the schema approach matters'),
                bodyText(
                  'Experiences in WE are defined as JSON schemas — not compiled, sealed code. This is a deliberate architectural choice with several significant consequences.',
                ),
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Inspectable and auditable'),
                    bodyText(
                      "Anyone can read a template and understand what it does before installing it. No hidden behaviours. That's a trust primitive most platforms don't have.",
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('AI-native by design'),
                    bodyText(
                      "Structured schemas are something language models can read, reason about, and generate reliably. WE isn't bolting AI onto a legacy system — it's designed from the ground up so AI can actively work inside the environment. AI already works today to generate templates from natural language descriptions.",
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Framework agnostic'),
                    bodyText(
                      'The schema system does not tie you or the ecosystem to any single frontend framework. Solid is the current default renderer, but the architecture is open.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Safe to share'),
                    bodyText(
                      'Declarative schemas can be shared, versioned, and forked without the risks of executing arbitrary code. The composability model is safe by design.',
                    ),
                  ],
                },
              ],
            },
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                sectionHeading('The interoperability advantage'),
                bodyText(
                  "WE sits on AD4M, which means WE experiences can read and render data from perspectives created by entirely independent tools — not just other WE experiences. Shared semantics at the protocol level means communities aren't trapped by whatever integrations a platform has chosen to build.",
                ),
              ],
            },
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                sectionHeading('Two-sided network effects'),
                bodyText(
                  'As more builders contribute templates and components, the environment becomes richer for communities. As more communities use WE, there are more real-world contexts in which your work gets tested, improved, and forked. Each side strengthens the other.',
                ),
                bodyText(
                  "That's a healthier model for building in this space than trying to permanently capture a community inside your product.",
                ),
              ],
            },
          ],
        },

        // ── How It Works ──────────────────────────────────────────────────
        {
          type: 'Column',
          props: { id: 'how-it-works', gap: '600', pt: '800', borderTop: '2px solid var(--we-color-neutral-200)' },
          children: [
            ...sectionHeader(DEEP_DIVE[2]),
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                sectionHeading('The core insight: separate data from interface'),
                bodyText(
                  "Most social software bundles data and interface together inseparably. Your posts live inside the app. The app's logic decides how to display them. Switch apps and you start over.",
                ),
                bodyText(
                  'WE takes a different approach: data and interface are explicitly separated. Your data lives in your own AD4M perspective. Experiences in WE are lenses over that data — different ways of viewing, interacting with, and organising the same underlying information.',
                ),
                bodyText(
                  'Install a new experience and it reads your existing data. Uninstall one and nothing is lost. The interface is not the data. It is just one way of seeing it.',
                ),
              ],
            },
            {
              type: 'Column',
              props: { gap: '400' },
              children: [
                sectionHeading('The block system: a shared content vocabulary'),
                bodyText(
                  'WE resolves content fragmentation with a shared block system: a standardised set of content primitives that every experience can read and render.',
                ),
                {
                  type: 'Column',
                  props: {
                    r: 'lg',
                    bg: 'neutral-100',
                    border: '1px solid var(--we-color-neutral-200)',
                    overflow: 'hidden',
                  },
                  children: [
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
                  ].map(([name, purpose]) => ({
                    type: 'Row',
                    props: {
                      gap: '400',
                      ay: 'start',
                      py: '200',
                      px: '400',
                      borderBottom: '1px solid var(--we-color-neutral-200)',
                    },
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
                      { type: 'we-text', props: { fontSize: '400', color: 'neutral-600' }, children: [purpose] },
                    ],
                  })),
                },
                bodyText(
                  'Think of these as the alphabet. The alphabet is fixed. The sentences are free. Any community can compose these blocks into any structure. New block types can extend what every community can express — without breaking anything that already exists.',
                ),
              ],
            },
            {
              type: 'Column',
              props: {
                gap: '400',
                p: '600',
                r: 'lg',
                bg: 'neutral-100',
                border: '1px solid var(--we-color-neutral-200)',
              },
              children: [
                sectionHeading('Templates: experiences as schemas'),
                bodyText(
                  'Every experience in WE is defined as a JSON schema — a structured, human-readable description of which components to include, how they are laid out, how they are styled, and what interactions are possible.',
                ),
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Inspectable'),
                    bodyText(
                      'You can read a template and understand exactly what it does before running it. No hidden logic, no black-box behaviours.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Forkable'),
                    bodyText(
                      'Copy a template, change what you need, publish the fork. The original is unaffected. Yours immediately has a working base.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('AI-readable'),
                    bodyText(
                      'Language models can parse, reason about, and generate valid schemas. AI can help communities customise their environment from natural language — working in the same structured format the system already speaks.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Framework-agnostic'),
                    bodyText(
                      'The schema specification is not tied to any single frontend framework. Solid is the current default renderer, but the architecture is open to others.',
                    ),
                  ],
                },
              ],
            },
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                sectionHeading('The signalling system'),
                bodyText(
                  "Communities don't all surface information the same way. WE's signalling system lets communities define their own signal types — what counts as relevant, urgent, well-crafted, or worth amplifying in their specific context.",
                ),
                bodyText(
                  'A research community might signal for epistemic confidence and novelty. A mutual aid network might signal for urgency and capacity to help. A creative collective might signal for craft and resonance. Each community defines what attention means for them.',
                ),
              ],
            },
            {
              type: 'Column',
              props: { gap: '400' },
              children: [
                sectionHeading('The AD4M foundation'),
                bodyText('Everything in WE sits on AD4M — the Agent-Centric Distributed Application Meta-protocol.'),
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Sovereign identity'),
                    bodyText(
                      'Every agent has a persistent, self-owned identity that works across communities and experiences. Your profile, relationships, and reputation are not locked inside any single app.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Agent-centric data'),
                    bodyText(
                      'Your data lives in your own AD4M perspective — a personal graph of everything connected to your identity. No central server owns it.',
                    ),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Peer-to-peer coordination'),
                    bodyText("Communities can operate without depending on any platform's servers."),
                  ],
                },
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    subheading('Semantic interoperability'),
                    bodyText(
                      'A shared predicate vocabulary means content created by entirely different tools can be understood and rendered by WE without prior coordination between builders.',
                    ),
                  ],
                },
              ],
            },
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                sectionHeading('Why a meta-app, not many separate apps'),
                bodyText(
                  'Separate apps recover sovereignty at the infrastructure layer but recreate fragmentation at the experience layer. Each app still rebuilds its own components from scratch, fractures identity and data across separate contexts, and resets innovation at its own boundary.',
                ),
                bodyText(
                  'WE provides a shared experiential layer on top of AD4M. Components and templates improve the whole ecosystem, not just one isolated product. Innovation compounds instead of resetting per app. Communities evolve without repeatedly starting from zero.',
                ),
              ],
            },
          ],
        },

        // ── See It In Practice ────────────────────────────────────────────
        {
          type: 'Column',
          props: {
            id: 'see-it-in-practice',
            gap: '600',
            pt: '800',
            borderTop: '2px solid var(--we-color-neutral-200)',
          },
          children: [
            ...sectionHeader(DEEP_DIVE[3]),
            bodyText(
              'The best way to understand WE is not the architecture, but the habit it creates: when a community needs something, they describe it, and the system helps build it.',
            ),
            // Research collective
            {
              type: 'Column',
              props: { gap: '300', p: '600', r: 'lg', bg: 'white', border: '1px solid var(--we-color-neutral-200)' },
              children: [
                subheading('A research collective'),
                bodyText(
                  'A group of independent researchers is tired of losing context across email threads, shared docs, and citation managers. They set up a community in WE.',
                ),
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    bulletItem(
                      'They fork a literature-review template and add a confidence-rating signal type specific to their methodology.',
                    ),
                    bulletItem(
                      'Papers are annotated as blocks. Signals surface what the group collectively considers well-evidenced versus speculative.',
                    ),
                    bulletItem(
                      'When a member leaves, they take their data. When a new member joins, they see the full annotated history.',
                    ),
                    bulletItem(
                      'An AI assistant reads the schema and helps the group run structured debates over contested claims.',
                    ),
                  ],
                },
              ],
            },
            // Mutual aid
            {
              type: 'Column',
              props: { gap: '300', p: '600', r: 'lg', bg: 'white', border: '1px solid var(--we-color-neutral-200)' },
              children: [
                subheading('A neighbourhood mutual aid network'),
                bodyText(
                  "A local network needs to coordinate offers and requests across a community of several hundred people. They don't want to depend on a third-party app that might disappear.",
                ),
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    bulletItem('They use an offer/request experience with custom urgency and capacity signals.'),
                    bulletItem(
                      'Members can see who has what, who needs what, and what is being actively coordinated — without ever exposing that data outside the group.',
                    ),
                    bulletItem(
                      'A fork of the experience adds a skills directory and an event board. Both share the same identity layer: one member profile, no separate logins.',
                    ),
                  ],
                },
              ],
            },
            // Creative collective
            {
              type: 'Column',
              props: { gap: '300', p: '600', r: 'lg', bg: 'white', border: '1px solid var(--we-color-neutral-200)' },
              children: [
                subheading('A creative collective'),
                bodyText(
                  'A distributed group of musicians, visual artists, and writers want a shared creative environment that feels genuinely theirs.',
                ),
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    bulletItem('They build a custom portfolio experience using ImageBlock, AudioBlock, and TextBlock.'),
                    bulletItem(
                      'They add a signal type for collaborative resonance — a way of saying "this connects with what I\'m making" rather than just a generic like.',
                    ),
                    bulletItem(
                      'When a member develops a residency context with a different community, they can install that template without disrupting their home environment.',
                    ),
                  ],
                },
              ],
            },
            // Open-source
            {
              type: 'Column',
              props: { gap: '300', p: '600', r: 'lg', bg: 'white', border: '1px solid var(--we-color-neutral-200)' },
              children: [
                subheading('An open-source project community'),
                bodyText(
                  "The project's developer community wants better coordination between their issue tracker, documentation, and async decision-making processes.",
                ),
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    bulletItem(
                      'They configure a community with linked experiences for proposals, structured discussions, and technical documentation.',
                    ),
                    bulletItem(
                      'Proposals use a custom signal type that tracks endorsement, concern, and abstention separately.',
                    ),
                    bulletItem(
                      'AI tools operate over the same schema the humans use — surfacing unresolved concerns and drafting documentation stubs.',
                    ),
                  ],
                },
              ],
            },
            // Educational
            {
              type: 'Column',
              props: { gap: '300', p: '600', r: 'lg', bg: 'white', border: '1px solid var(--we-color-neutral-200)' },
              children: [
                subheading('An educational community'),
                bodyText(
                  'A learning cooperative wants to build curriculum together, track member progress, and surface what is actually working.',
                ),
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    bulletItem(
                      'Lessons are TextBlock and VideoBlock sequences, annotated with ChecklistBlock assessments.',
                    ),
                    bulletItem('Signals track what members found genuinely useful versus what felt like padding.'),
                    bulletItem(
                      'The community forks a module, adapts it to their context, and publishes the adaptation — giving it back to anyone else who might need it.',
                    ),
                  ],
                },
              ],
            },
            // Governance
            {
              type: 'Column',
              props: { gap: '300', p: '600', r: 'lg', bg: 'white', border: '1px solid var(--we-color-neutral-200)' },
              children: [
                subheading('A decentralised governance group'),
                bodyText(
                  'A group making collective decisions across time zones and disciplines needs structured deliberation without the chaos of unthreaded chat.',
                ),
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    bulletItem(
                      'They run a proposal template with defined phases: draft, discussion, amendment, and decision.',
                    ),
                    bulletItem(
                      'Signals distinguish between support, concern, amendment suggestion, and blocking objection.',
                    ),
                    bulletItem(
                      'Every decision has a legible history: what was proposed, what changed, why, and how the outcome was reached.',
                    ),
                  ],
                },
              ],
            },
            // The pattern
            {
              type: 'Column',
              props: {
                gap: '400',
                p: '600',
                r: 'lg',
                bg: 'neutral-100',
                border: '1px solid var(--we-color-neutral-200)',
              },
              children: [
                sectionHeading('The pattern underneath'),
                bodyText('Across all of these: the community owns their environment, not the platform.'),
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
                bodyText(
                  'This is what cooperative infrastructure looks like in practice: not tools designed to capture communities, but tools communities genuinely control.',
                  true,
                ),
              ],
            },
          ],
        },

        // ── Closing statement ─────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '400', p: '700', r: 'lg', bg: 'neutral-100', border: '1px solid var(--we-color-neutral-200)' },
          children: [
            sectionHeading('What this adds up to'),
            bodyText(
              'Most communities today are capable of growing, creating, and self-organising — but unable to evolve the software conditions they live inside. The tools shape the community far more than the community can shape the tools.',
            ),
            bodyText(
              'WE is an attempt to change that. Not by building a better platform, but by giving communities a shared environment where the tools themselves can be owned, adapted, and passed on.',
            ),
            bodyText(
              'The deeper bet: given the right infrastructure, communities will discover forms of coordination and collective intelligence that no platform team would have designed for them. And those discoveries will spread.',
              true,
            ),
          ],
        },

        // ── Close button ──────────────────────────────────────────────────
        {
          type: 'Row',
          props: { ax: 'center' },
          children: [
            {
              type: 'we-button',
              props: {
                text: 'Back to WE',
                variant: 'secondary',
                onClick: { $action: 'templateStore.closeShellView', args: [] },
              },
            },
          ],
        },
      ],
    },
  ],
};
