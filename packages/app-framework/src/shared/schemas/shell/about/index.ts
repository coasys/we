import type { TemplateSchema } from '@we/schema-shared';
// ─── Image Sets ───────────────────────────────────────────────────────────────

import forCommunitiesV1 from '../../../assets/CTAv1/ForCommunities.jpg';
import forBuildersV1 from '../../../assets/CTAv1/ForBuilders.jpg';
import howItWorksV1 from '../../../assets/CTAv1/HowItWorks.jpg';
import seeItInPracticeV1 from '../../../assets/CTAv1/SeeItInPractice.jpg';

import forCommunitiesV2 from '../../../assets/CTAv2/ForCommunities.jpg';
import forBuildersV2 from '../../../assets/CTAv2/ForBuilders.jpg';
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

const IMAGES = IMAGE_SETS.v2; // ← toggle here

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
      ...(italic ? { fontStyle: 'italic', fontWeight: 'medium' } : {}),
    },
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

// ─── Flip Cards ───────────────────────────────────────────────────────────────

const CARDS = [
  {
    front: {
      icon: 'castle-turret',
      title: "You're renting your own community.",
      body: "Every group chat or shared workspace lives on someone else's land. One day they change the rules, raise prices, or shut down — and your entire history and culture can vanish overnight.",
    },
    back: {
      icon: 'house-line',
      title: 'Own your data. Keep your history.',
      body: 'In WE, your community owns everything. Data lives in decentralised infrastructure you control. Uninstall an experience and your data stays. Move to a better tool and your history comes with you.',
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
      title: 'Your whole community, in one place.',
      body: "WE is one environment where discussion, signals, shared knowledge, and coordination all live together — under one identity. Your community doesn't bolt on another tool. It evolves its environment.",
    },
  },
  {
    front: {
      icon: 'lock-simple',
      title: "You can't change the tools you depend on.",
      body: 'You can pick a theme or add a bot, but the real decisions — how votes work, how information surfaces, what signals mean — are locked by developers. Your culture gets flattened to fit their product.',
    },
    back: {
      icon: 'git-fork',
      title: 'Fork it, reshape it, make it yours.',
      body: 'In WE, every experience is built from structured templates anyone can inspect, adapt, and share. Define what signals mean for your community. Fork a tool, make it fit, publish it back for others.',
    },
  },
  {
    front: {
      icon: 'cube-transparent',
      title: 'Great ideas stay trapped inside single groups.',
      body: 'One community figures out a brilliant way to run decisions or share resources. But that discovery never escapes the group it was built in. Every community keeps reinventing the same wheels.',
    },
    back: {
      icon: 'storefront',
      title: 'Build once. Share with everyone.',
      body: 'WE is being built around a shared marketplace where coordination patterns, templates, and tools can be published, forked, and improved by anyone. Build something better — the whole ecosystem benefits.',
    },
  },
  {
    front: {
      icon: 'translate',
      title: 'Switching tools means losing your history.',
      body: 'What works for 20 people breaks at 200. You outgrow your tools but switching means losing years of conversations, decisions, and context. So you stay stuck with something that no longer fits.',
    },
    back: {
      icon: 'stack',
      title: 'Evolve your tools. Keep your memory.',
      body: "Because WE separates data from interface, upgrading your tools doesn't mean losing your history. Swap in a new template, redesign how information surfaces — the community's memory stays intact.",
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

// ─── Deep Dive Cards ─────────────────────────────────────────────────────────

const DEEP_DIVE = [
  {
    id: 'for-communities',
    icon: 'users',
    label: 'For communities',
    title: 'Tools that belong to your community, not a platform.',
    preview:
      "Your community's tools should grow with you — not trap your data, resist change, or disappear when a platform pivots. WE gives you an environment you shape over time, with full continuity of history and identity.",
    image: IMAGES.forCommunities,
    imageAlt: 'Communities collaborating',
  },
  {
    id: 'for-builders',
    icon: 'hammer',
    label: 'For builders',
    title: 'Stop rebuilding the 80%. Start only building what is actually yours.',
    preview:
      "Every team building social tools reinvents the same 80%. WE turns that 80% into shared infrastructure — so you only build the 20% that's actually yours. Publish it once. The whole ecosystem benefits.",
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
    props: { p: '700', gap: '400', ay: 'center', ax: 'start' },
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
  'Schema-driven UI rendering — experiences defined as JSON schemas, rendered live',
  'Template system — community environments that can be forked, customised, and AI-generated',
  'Block system — a shared content vocabulary (text, images, audio, video, collections, polls, maps, and more)',
  'Design system — tokens, primitives, components, and widgets shared across all experiences',
  'Signalling system — communities can define their own signal types and attach meaning to content',
  'AI template generation — describe what you need, AI builds a working template from your data structures',
  'AD4M integration — sovereign identity, agent-centric data, peer-to-peer coordination',
  'Sub-app integration — existing AD4M applications (including Flux) can run inside WE',
  'Themes — visual customisation across experiences',
];

const IN_PROGRESS = [
  'Marketplace — discovery and publishing infrastructure for templates, widgets, and block types',
  'Governance modules — structured proposal and decision-making tools',
  'Economics and resource coordination flows',
];

function roadmapItem(text: string, done: boolean) {
  return {
    type: 'Row',
    props: { gap: '300', ay: 'start' },
    children: [
      {
        type: 'we-icon',
        props: {
          name: done ? 'check-circle' : 'circle-dashed',
          size: 'sm',
          color: done ? 'success-500' : 'neutral-400',
          mt: '50',
        },
      },
      {
        type: 'we-text',
        props: { fontSize: '400', color: done ? 'neutral-800' : 'neutral-500', lineHeight: '1.6' },
        children: [text],
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
      props: { px: '500', py: '800', gap: '800', maxWidth: '1100px', width: '100%' },
      children: [
        // ── Hero ──────────────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '400', ax: 'center' },
          children: [
            // { type: 'WeCube', props: { width: '500px', height: '400px' } },
            {
              type: 'we-text',
              props: { fontSize: '36px', fontWeight: 'bold', color: 'neutral-900', textAlign: 'center', mb: '100' },
              children: ['Social infrastructure for a more cooperative world.'],
            },
            {
              type: 'we-text',
              props: { fontSize: '600', color: 'neutral-700', textAlign: 'center', maxWidth: '720px' },
              children: [
                "Scattered across the planet are the insights, resources, and creativity needed to solve the hardest problems we face. But we're held back by social infrastructure built to extract from us, not evolve with us.",
              ],
            },
            {
              type: 'we-text',
              props: { fontSize: '600', color: 'neutral-700', textAlign: 'center', maxWidth: '720px' },
              children: [
                "WE is a shared environment where communities can reclaim their tools, build on each other's discoveries, and coordinate on their own terms — infrastructure designed for cooperation, not capture.",
              ],
            },
          ],
        },

        // ── Card section label ────────────────────────────────────────────
        {
          type: 'Column',
          props: { ax: 'center' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '400', color: 'neutral-500', textAlign: 'center' },
              children: ['Tap a card to see how WE changes this'],
            },
          ],
        },

        // ── Flip card grid ────────────────────────────────────────────────
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
          props: { gap: '500' },
          children: [
            {
              type: 'Column',
              props: { gap: '100', ax: 'center' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '700', fontWeight: 'bold', color: 'neutral-900', textAlign: 'center' },
                  children: ['Go deeper'],
                },
                {
                  type: 'we-text',
                  props: { fontSize: '500', color: 'neutral-600', textAlign: 'center' },
                  children: ["WE means something different depending on where you're coming from."],
                },
              ],
            },
            ...DEEP_DIVE.map((card, i) => ctaCard(card, i % 2 === 0)),
          ],
        },

        // ── For Communities ───────────────────────────────────────────────
        {
          type: 'Column',
          props: { id: 'for-communities', gap: '600', pt: '800', borderTop: '2px solid var(--we-color-neutral-200)' },
          children: [
            sectionHeading('Tools that belong to your community, not a platform.'),
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
              props: { gap: '400' },
              children: [
                sectionHeading('What WE makes possible'),
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
                r: 'lg',
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
            sectionHeading('Stop rebuilding the 80%. Start only building what is actually yours.'),
            bodyText(
              'The features that make your project genuinely novel — a unique way to surface signals, a different model for resource coordination, a new kind of community interface — represent maybe 20% of what you need to build. The other 80% is infrastructure almost every social tool needs: identity, profiles, posts, threads, feeds, roles, notifications, moderation, content composition, data storage.',
            ),
            bodyText(
              "That 80% gets rebuilt from scratch, in isolation, by every team in the space. The result is a graveyard of incompatible systems, duplicated effort, and experiences that can't interoperate even when they're solving adjacent problems.",
            ),
            bodyText('WE is designed to change that.'),
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                sectionHeading('Shared infrastructure, not shared constraints'),
                bodyText(
                  'WE provides the 80% as shared, open infrastructure. Every community using WE gets identity, data continuity, a content composition system, a design system, and a component ecosystem — built in, available, and consistent.',
                ),
                bodyText(
                  "That means when you build for WE, you're building the 20%: the novel interface, the unique signalling logic, the coordination pattern that makes your project genuinely interesting.",
                ),
                bodyText(
                  "You publish it as a template, a widget, or a block type. Others can adopt it, fork it, improve it, and publish improvements back. The whole ecosystem gets smarter from work you've already done.",
                ),
                bodyText(
                  "This isn't just a developer convenience. It's a structural shift in how social tool innovation works — from isolated products competing through lock-in, to a compounding commons where good ideas spread.",
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
            sectionHeading('A shared vocabulary for community software.'),
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
            sectionHeading('What communities actually do with WE.'),
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

        // ── Roadmap ───────────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '500', p: '700', r: 'lg', bg: 'neutral-100', border: '1px solid var(--we-color-neutral-200)' },
          children: [
            {
              type: 'Column',
              props: { gap: '100' },
              children: [
                sectionHeading('Where we are'),
                {
                  type: 'we-text',
                  props: { fontSize: '500', color: 'neutral-600' },
                  children: ["WE is in active development. Here's an honest picture of what's built and what's next."],
                },
              ],
            },
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '500', fontWeight: 'semibold', color: 'neutral-900' },
                  children: ['Built and working'],
                },
                ...BUILT.map((item) => roadmapItem(item, true)),
              ],
            },
            {
              type: 'Column',
              props: { gap: '300' },
              children: [
                {
                  type: 'we-text',
                  props: { fontSize: '500', fontWeight: 'semibold', color: 'neutral-900' },
                  children: ['In progress'],
                },
                ...IN_PROGRESS.map((item) => roadmapItem(item, false)),
              ],
            },
            {
              type: 'we-text',
              props: { fontSize: '500', fontWeight: 'semibold', color: 'neutral-700', fontStyle: 'italic' },
              children: ['The foundation is solid. The ecosystem is just beginning.'],
            },
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
