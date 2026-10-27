import type { SchemaNode, TemplateSchema } from '@we/schema-shared';

import { COASYS_MARK } from './brand.ts';

/**
 * About Coasys: the first screen of coasys.org, inside the app.
 *
 * The site's header and hero, everything above its partners, as a page of the Coasys bundle's own:
 * the logo and the links beside it, the eyebrow, the typing headline, the line under it, the film
 * with its captions and transcript, and the photo credit the film owes. "Watch the film" plays it in
 * place; "See the app" closes the page onto the spaces behind it, which is where the site's button
 * sends a reader too. The header leaves out the site's menu and its "Log in", which are the site's
 * own: the app has its own account and its own way round.
 *
 * The copy, the sizes and the light behind it are the site's (its `home` and `Header` styles), so
 * the two read as one; when the site's hero changes, change it here. The film is not copied: it is
 * played from coasys.org, which serves it to other origins and which a Coasys deployment's seed
 * allows (`contentSecurity` in `seeds/coasys.seed.json`).
 */

/** Where the film lives. The site's own files, so the app plays the cut the site does. */
const SITE = 'https://coasys.org';

const FILM = {
  src: `${SITE}/films/coasys-overview-nico2-720p.mp4`,
  poster: `${SITE}/films/film-poster-r13.webp`,
  captions: `${SITE}/films/coasys-overview-nico2.en.vtt`,
  length: '4 min',
  lead: 'How life holds together without a boss, and how we are building the same for people and AI. Four minutes.',
};

const HEADLINE = 'We are building';
const PHRASES = [
  'a global brain.',
  'a nervous system for society.',
  'intelligence no one owns.',
  'a counterweight to big AI.',
];
const SUBLINE =
  'Groups of people and AI agents, each keeping their own rules, learning as one network. Our bet: together they out-learn any centralized system.';

/** The one photograph in the film is CC BY 2.0, so its credit goes under the film wherever it plays. */
const CREDIT = {
  title: 'Autumn magic',
  author: 'Holly Victoria Norval',
  source: 'https://www.flickr.com/photos/hollystar47/30763457786/',
  licence: 'CC BY 2.0',
  licenceUrl: 'https://creativecommons.org/licenses/by/2.0/',
  changes: 'cropped, colour-graded, graphic overlay added',
};

/** One paragraph per part of the film, in the order it is spoken — Nico's words as recorded. */
const TRANSCRIPT = [
  'Every system has to hold together, and still let its parts be free. In a forest, every tree grows its own way, and roots and fungi hold it together. More than trees: a forest, where other life can grow. Small groups do it too: they make their own rules, and change them as they go.',
  'To grow, we locked them down: tribe, city, empire, company, platform. Now AI could finish the job: one giant model, owned by a few, fed by all of us, and soon thinking for all of us. Or it breaks us apart: anyone can make an app, a video, a whole game, in an afternoon, and none of them fit together. In a body, that is cancer: cells that stopped talking to their neighbours.',
  'Life holds together and stays free: coherence and sovereignty. But AI squeezes the middle path, and pushes us to get right a problem as old as life. How can we cohere at scale without losing our sovereignty?',
  'There is a third way, and life found it long ago: DNA, inside a membrane. A group has social DNA too: its rules, its governance, its culture. Each group writes its own, and no one else has to agree. Around each group is a membrane: what crosses is checked at the edge, against its DNA. Inside, everyone is free: any app, any screen, any AI bot. Sovereignty stays inside. Coherence is made at the crossing.',
  'Isn’t that the web already, you may ask? Well, it was meant to be. But it grew around servers, and servers serve their owners. Together, social DNA and membranes make a spanning layer across all our groups. Groups stack into groups of groups. No one DNA is forced on all, so each keeps adapting and evolving.',
  'That is what we at Coasys build, in three pieces. The first is AD4M. It lays one layer over our networks, with you at the centre, not a server. Centralized, peer-to-peer, or federated: they all plug in. Your identity, your data, your groups: they go with you from app to app. We built it close to today’s web standards, and we’re extending them. We call it the Living Web.',
  'We is the interface layer. Each space’s rules come with a screen that fits them. Anyone can change it, extend it, and share the UI pieces with other groups.',
  'And Synergy gives the value of the created work back to the groups who do it. Every group turns its members’ work into one shared result, and backs it with its own weight. So do groups of groups. Then the world answers, and the answer is passed back down to everyone who fed it. What held up gains backing. What didn’t loses weight, like a brain learning which connections to trust, and for what. Not everyone has to join. Taking part is a free choice. But it’s built so that honesty, and work that fits the whole, comes out ahead. No single party or AI decides what fits. The whole does. It grows from the bottom up, as people connect and their groups join into larger ones. That’s why we call it Synergy.',
  'Add it all up, and you get a global brain: many minds, people and AI, each still themselves. Our alternative to one giant model in a lab. Free and together. Sovereignty and coherence, one group at a time.',
];

/**
 * The light behind the hero, as the site lays it: a mint glow off the top right and a violet one low
 * on the left, over a faint mint haze and a violet wash that fades by the bottom. The site draws the
 * two glows as blurred circles placed against its 1440px container; these are the same gradients
 * and the same places, measured against the page's own width rather than the window's, since the
 * page may sit beside the app's rail.
 */
const HERO_LIGHT = [
  'radial-gradient(circle 400px at calc(50% + min(50%, 720px) - 150px) 200px, rgba(117,255,190,.22), rgba(117,255,190,0))',
  'radial-gradient(circle 550px at calc(50% - min(50%, 720px) + 200px) 650px, rgba(109,38,183,.55), rgba(109,38,183,0))',
  'radial-gradient(70% 55% at 62% 0, rgba(117,255,190,.07), rgba(117,255,190,0))',
  'linear-gradient(180deg, rgba(92,74,168,.12), rgba(19,21,51,0) 85%)',
].join(', ');

/** The site's lines and pills: its light grey at 30%, and a wash of it at 8%. */
const HAIRLINE = 'rgba(199,201,220,.3)';
const WASH = 'rgba(199,201,220,.08)';

/** The site's logo is the Coasys mark in white. */
const LOGO = `data:image/svg+xml,${encodeURIComponent(COASYS_MARK.replace(/fill="[^"]*"/g, 'fill="#ffffff"'))}`;

const play = { $setLocal: 'playing', value: true };

const icon = (name: string): SchemaNode => ({ type: 'we-icon', props: { name, weight: 'fill' } });

const link = (href: string, text: string): SchemaNode => ({
  type: 'we-link',
  props: { href, target: '_blank', rel: 'noopener noreferrer' },
  children: [text],
});

/** A link in the header's row: the site's light grey, white under the pointer. */
const headerLink = (href: string, text: string, props: Record<string, unknown> = {}): SchemaNode => ({
  type: 'we-link',
  props: {
    href,
    target: '_blank',
    fontSize: '16px',
    fontWeight: '500',
    color: 'text-muted',
    textDecoration: 'none',
    hoverProps: { color: 'text' },
    ...props,
  },
  children: [text],
});

/**
 * The site's header, over the top of the hero: the logo and name, its two papers, Discord, and AD4M
 * on GitHub with its stars. The papers go below the site's tablet width and Discord below its phone
 * width, as on the site; the nearest of the app's widths stand in for the site's 1000px and 600px.
 *
 * The site counts AD4M's stars live from GitHub's API and shows 100 until the count arrives. A
 * template cannot ask GitHub, so this shows the site's own figure, as the site does when it cannot.
 */
const header: SchemaNode = {
  type: 'Row',
  props: { position: 'absolute', top: '0', left: '0', right: '0', ax: 'center' },
  children: [
    {
      type: 'Row',
      props: {
        width: '100%',
        maxWidth: '1300px',
        height: '120px',
        px: '30px',
        ax: 'between',
        ay: 'center',
        smUpProps: { px: '60px' },
      },
      children: [
        {
          type: 'we-link',
          props: {
            href: SITE,
            target: '_blank',
            display: 'flex',
            ay: 'center',
            gap: '15px',
            color: 'text',
            textDecoration: 'none',
            fontSize: '24px',
            fontWeight: '800',
            smUpProps: { fontSize: '34px' },
          },
          children: [
            {
              type: 'we-image',
              props: {
                src: LOGO,
                alt: '',
                width: '50px',
                height: '50px',
                smUpProps: { width: '60px', height: '60px' },
              },
            },
            'coasys',
          ],
        },
        {
          type: 'Row',
          props: { gap: '14px', ay: 'center', smUpProps: { gap: '22px' } },
          children: [
            headerLink(`${SITE}/Synergy_whitepaper.pdf`, 'Synergy paper', {
              display: 'none',
              mdUpProps: { display: 'inline' },
            }),
            headerLink(`${SITE}/Coasys-Livepaper-2026-06-09.pdf`, 'Livepaper', {
              display: 'none',
              mdUpProps: { display: 'inline' },
            }),
            {
              type: 'we-link',
              props: {
                href: 'https://discord.gg/fYGVM66jEz',
                target: '_blank',
                label: 'Discord',
                color: 'text-muted',
                hoverProps: { color: 'text' },
                display: 'none',
                smUpProps: { display: 'flex' },
              },
              children: [{ type: 'we-icon', props: { name: 'discord-logo', weight: 'fill', size: '22px' } }],
            },
            {
              type: 'we-link',
              props: {
                href: 'https://github.com/coasys/ad4m',
                target: '_blank',
                label: 'AD4M on GitHub, 100 stars',
                display: 'flex',
                ay: 'stretch',
                height: '36px',
                r: '18px',
                overflow: 'hidden',
                border: `1px solid ${HAIRLINE}`,
                color: 'text',
                textDecoration: 'none',
                fontSize: '14px',
                fontWeight: '600',
              },
              children: [
                {
                  type: 'Row',
                  props: { ay: 'center', gap: '8px', pl: '14px', pr: '12px' },
                  children: [
                    // Regular, not fill: Phosphor's filled mark is the bare cat, the site's is the ringed one.
                    { type: 'we-icon', props: { name: 'github-logo', size: '18px' } },
                    {
                      type: 'we-text',
                      props: { fontSize: '14px', fontWeight: '600', display: 'none', smUpProps: { display: 'inline' } },
                      children: ['GitHub'],
                    },
                  ],
                },
                {
                  type: 'Row',
                  props: { ay: 'center', pl: '12px', pr: '14px', bg: WASH, borderLeft: `1px solid ${HAIRLINE}` },
                  children: [{ type: 'we-text', props: { fontSize: '14px', fontWeight: '600' }, children: ['★ 100'] }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** The poster, with the play button on it: pressing anywhere on it starts the film. */
const poster: SchemaNode = {
  type: 'we-button',
  props: {
    variant: 'bare',
    width: '100%',
    height: '100%',
    label: `Play: The Coasys film · ${FILM.length} · with sound`,
    onClick: play,
  },
  children: [
    {
      type: 'Column',
      props: { position: 'relative', width: '100%', height: '100%' },
      children: [
        // Dimmed until pointed at, and darkened along the bottom so the caption reads, as on the site.
        {
          type: 'we-image',
          props: {
            src: FILM.poster,
            alt: '',
            fit: 'cover',
            width: '100%',
            height: '100%',
            opacity: 0.75,
            hoverProps: { opacity: 1 },
          },
        },
        {
          type: 'Column',
          props: {
            position: 'absolute',
            top: '55%',
            left: '0',
            right: '0',
            bottom: '0',
            bgImage: 'linear-gradient(180deg, rgba(13,15,38,0), rgba(13,15,38,.75))',
            pointerEvents: 'none',
          },
        },
        {
          type: 'Row',
          props: { position: 'absolute', left: '600', bottom: '500', gap: '300', ay: 'center' },
          children: [
            {
              type: 'Row',
              props: { width: '72px', height: '72px', r: 'full', bg: 'accent', ax: 'center', ay: 'center' },
              children: [{ type: 'we-icon', props: { name: 'play', weight: 'fill', size: 'lg', color: 'on-accent' } }],
            },
            {
              type: 'we-text',
              props: { variant: 'label', color: 'text' },
              children: [`The Coasys film · ${FILM.length} · with sound`],
            },
          ],
        },
      ],
    },
  ],
};

const player: SchemaNode = {
  type: 'we-video',
  props: {
    src: FILM.src,
    poster: FILM.poster,
    controls: true,
    autoplay: true,
    playsinline: true,
    preload: 'metadata',
    fit: 'contain',
    width: '100%',
    height: '100%',
    tracks: [{ src: FILM.captions, srclang: 'en', label: 'English', kind: 'captions', default: true }],
    // Captions from another origin load only over CORS, and asking for it asks for the film the same way.
    crossorigin: 'anonymous',
  },
};

const film: SchemaNode = {
  type: 'Column',
  props: { width: '100%', maxWidth: '920px', gap: '200', mt: '300' },
  children: [
    {
      type: 'we-text',
      props: { tag: 'p', color: 'text-muted', fontSize: '17px', lineHeight: '1.45', maxWidth: '800px' },
      children: [FILM.lead],
    },
    {
      type: 'Column',
      props: {
        width: '100%',
        aspectRatio: '16 / 9',
        r: '18px',
        overflow: 'hidden',
        border: '1px solid accent-border',
        bg: 'chrome',
        shadow: 'lg',
      },
      children: [{ type: '$if', props: { condition: { $: 'local.playing' }, then: player, else: poster } }],
    },
    {
      type: 'Row',
      props: { gap: '100', ay: 'center', wrap: true },
      children: [
        { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: ['Captions on ·'] },
        {
          type: 'we-button',
          props: {
            variant: 'ghost',
            size: 'xs',
            expanded: { $: 'local.transcript' },
            onClick: { $toggleLocal: 'transcript' },
          },
          children: [{ $: "local.transcript ? 'Hide the transcript' : 'Transcript'" }],
        },
      ],
    },
    {
      type: 'we-text',
      props: { variant: 'footnote', color: 'text-faint' },
      children: [
        'Forest photo: ',
        link(CREDIT.source, `“${CREDIT.title}”`),
        ` by ${CREDIT.author}, `,
        link(CREDIT.licenceUrl, CREDIT.licence),
        `, modified (${CREDIT.changes})`,
      ],
    },
    {
      type: '$if',
      props: {
        condition: { $: 'local.transcript' },
        enterTransition: [
          { type: 'reveal', duration: 250 },
          { type: 'fade', duration: 180 },
        ],
        then: {
          type: 'Column',
          props: {
            gap: '300',
            p: '400',
            mt: '200',
            maxHeight: '320px',
            overflowY: 'auto',
            r: '12px',
            border: '1px solid border',
            bg: 'surface-sunken',
          },
          children: TRANSCRIPT.map((paragraph) => ({
            type: 'we-text',
            props: { tag: 'p', color: 'text-muted' },
            children: [paragraph],
          })),
        },
      },
    },
  ],
};

export const coasysAbout: TemplateSchema & { id: string } = {
  id: 'about',
  meta: {
    name: 'About Coasys',
    description: 'What Coasys is building, and the film that tells it',
    icon: 'info',
    role: 'page',
  },
  type: 'Column',
  $localState: {
    playing: { type: 'boolean', initial: false },
    transcript: { type: 'boolean', initial: false },
  },
  // The site's light rather than the theme's orbs, which are the app's: an element's own image
  // replaces its surface's.
  props: { position: 'relative', width: '100%', minHeight: '100%', bg: 'page', bgImage: HERO_LIGHT, ax: 'center' },
  children: [
    header,
    {
      type: 'Column',
      // Clear of the header, which sits over the top of the page as the site's does.
      props: {
        width: '100%',
        maxWidth: '1200px',
        px: '22px',
        pt: '110px',
        pb: '56px',
        gap: '400',
        smUpProps: { px: '40px' },
        mdUpProps: { pt: '124px', pb: '70px' },
      },
      children: [
        { type: 'we-text', props: { variant: 'overline', color: 'accent-text' }, children: ['Coasys'] },
        {
          type: 'we-text',
          // The site's hero is larger than any heading inside the app: the display size from md up.
          props: { variant: 'heading-xl', tag: 'h1', maxWidth: '1000px', mdUpProps: { fontSize: '900' } },
          children: [
            { type: 'we-typewriter', props: { text: HEADLINE, phrases: PHRASES, phraseColor: 'accent-text' } },
          ],
        },
        {
          type: 'we-text',
          props: { variant: 'ingress', tag: 'p', maxWidth: '800px', color: 'text' },
          children: [SUBLINE],
        },
        {
          type: 'Row',
          props: { gap: '400', wrap: true },
          children: [
            {
              type: 'we-button',
              props: { variant: 'solid', size: 'lg', onClick: play },
              children: [icon('play'), 'Watch the film'],
            },
            {
              type: 'we-button',
              props: { variant: 'outline', size: 'lg', onClick: { $invoke: 'shellStore.closeShellView', args: [] } },
              children: ['See the app'],
            },
          ],
        },
        film,
      ],
    },
  ],
};
