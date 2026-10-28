import type { SchemaNode, TemplateSchema, ThemeOverrides } from '@we/schema-shared';

import { COASYS_MARK } from './brand.ts';
import { glowTheme } from './themes.ts';

/**
 * About Coasys: the first screens of coasys.org, inside the app.
 *
 * The site's home page down to its team, as a page of the Coasys bundle's own:
 *
 * - the header — the logo and the links beside it, without the site's menu and "Log in", which are
 *   the site's own;
 * - the hero — the eyebrow, the typing headline, the line under it, the film with its captions and
 *   transcript, and the photo credit the film owes. "Watch the film" plays it in place; "See the
 *   app" goes down to the app section, as the site's does;
 * - the partners — their logos in white, on a band that carries the page from the hero into the app;
 * - the app — its own film and what it does, with how far along each part is. Where the site asks
 *   for an email for its waitlist, this has a way into your spaces;
 * - underneath — the three layers, each linking to its page on the site.
 *
 * The team, the blog and the community are left to the site, with a link: they change too often to
 * keep a copy of.
 *
 * The copy, the sizes and the light are the site's (its `home` and `Header` styles), so the two read
 * as one; when the site changes, change this. The films and pictures are not copied: they are
 * played from coasys.org, which serves them to other origins and which a Coasys deployment's seed
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

/** The site's second film, in the app section: three minutes inside a space. */
const APP_FILM = {
  src: `${SITE}/films/coasys-app-v11-720p.mp4`,
  poster: `${SITE}/films/coasys-app-v11-poster.webp`,
  captions: `${SITE}/films/coasys-app-v11.en.vtt`,
  caption: 'The Coasys app · 3:39',
};

/** What the site says the app does, and how far along each part is — word for word. */
const STATUS = { today: 'Works today', alpha: 'Works today · alpha', next: 'Next', design: 'In design' } as const;
type Status = (typeof STATUS)[keyof typeof STATUS];

const APP_POINTS: { title: string; text: string; status: Status }[] = [
  {
    title: 'Your own space',
    text: 'Calls, chat and a shared board in one place. Your group sets the rules.',
    status: STATUS.alpha,
  },
  {
    title: 'The AI drafts. People decide.',
    text: "After a call, your group's AI suggests tasks and events from it. Nothing is added until someone accepts it.",
    status: STATUS.alpha,
  },
  {
    title: 'Bring your agents',
    text: "Any assistant that speaks MCP can join, with an account of its own. The group's AI runs on the model you pick, even a local one.",
    status: STATUS.today,
  },
  {
    title: 'You set the bar',
    text: 'Decide how many people must sign off before work moves on. Each sign-off is signed. Built; it ships in the next release.',
    status: STATUS.next,
  },
];

/** The three layers under the app, each in its colour on the site: blue, mint and orange. */
const LAYERS: {
  name: string;
  role: string;
  line: string;
  status: Status;
  still: string;
  alt: string;
  href: string;
  color: string;
}[] = [
  {
    name: 'AD4M',
    role: 'The spanning layer',
    line: "One open layer for your identity, your data and your group's shared spaces.",
    status: STATUS.today,
    still: `${SITE}/cards/card-ad4m.webp`,
    alt: 'The AD4M bar in blue, with three groups above it and three kinds of network below: centralized, peer-to-peer, federated.',
    href: `${SITE}/adam`,
    color: 'cyan',
  },
  {
    name: 'We',
    role: 'The interface layer',
    line: 'Each space carries its own screens. Its members can change them and share them with other groups.',
    status: STATUS.alpha,
    still: `${SITE}/cards/card-we.webp`,
    alt: "A group's space in the app: its rules, a board and a sign-off panel side by side.",
    href: `${SITE}/we`,
    color: 'accent',
  },
  {
    name: 'Synergy',
    role: 'The value layer',
    line: 'Designed to give the value of our work back to the groups who do it.',
    status: STATUS.design,
    still: `${SITE}/cards/card-synergy.webp`,
    alt: 'Groups under a bar labelled the world, what actually happens; each has a bar for how much backing it has.',
    href: `${SITE}/synergy`,
    color: 'orange',
  },
];

/** Who the site thanks, in its order; each logo at four fifths of its drawn height, as the site sets them. */
const PARTNERS: { name: string; alt?: string; href: string; h: number }[] = [
  { name: 'holochain', href: 'https://www.holochain.org', h: 30 },
  { name: 'holo', href: 'https://www.holo.host', h: 21 },
  { name: 'holoventures', alt: 'Holo Ventures', href: 'https://holoventures.io', h: 36 },
  { name: 'corenexus', href: 'https://corenexus.is', h: 26 },
  { name: 'trustgraph', href: 'https://trustgraph.net', h: 40 },
  { name: 'symphonics', href: 'https://www.symphonics.life', h: 36 },
  { name: 'cacoon', href: 'https://www.michkaelbaker.com', h: 22 },
  { name: 'asraya', href: 'https://asraya.io', h: 50 },
  { name: 'nillion', href: 'https://nillion.com/', h: 27 },
  { name: 'weco', href: 'https://weco.io/', h: 50 },
  { name: 'holons', href: 'https://www.holons.io/', h: 40 },
];

/** The violet the app section's wash starts from, and the partners band arrives at. */
const APP_VIOLET = 'rgba(92,74,168,.14)';

/** The faint violet wash at the top of the app section. */
const APP_WASH = `linear-gradient(180deg, ${APP_VIOLET}, rgba(19,21,51,0))`;

/**
 * The partners band: the page where the hero's light has faded, deepening to the violet the app
 * section opens with, so neither edge is a seam.
 */
const PARTNERS_BAND = `linear-gradient(180deg, rgba(92,74,168,0), ${APP_VIOLET})`;

/**
 * The page's theme: Glow, which is the site's look, with the site's secondary button — a 2px mint
 * outline round white words, filled with the lighter mint under the pointer.
 *
 * Glow whichever theme the person has chosen, because the page is the site's and the site has one
 * look: its light, its white logo and its colours are written for that indigo, and would be wrong
 * on a light page. And a whole theme rather than the button alone, because a node's theme is a
 * whole theme — it is applied as one, not laid over the theme around it.
 *
 * Glow's own outline is Nico's in-app one, a muted 1.5px line, and stays so everywhere else: the
 * two are the site's language and the app's, and this page speaks the site's.
 */
const glow = glowTheme.overrides as ThemeOverrides;
const SITE_THEME: ThemeOverrides = {
  ...glow,
  // The site's pace: a hover arrives over 300ms (its --transition-speed), where the app's controls
  // answer in 50ms. Leaving a state still snaps, as it does everywhere in the design system.
  stateDuration: '300ms',
  // The site's buttons: 18px words, smaller than the app's large size, 60px either side of them, and
  // 8px between an icon and its words. The app runs on a desktop, so the site's desktop measure.
  typeStyles: { ...glow.typeStyles, control: { ...glow.typeStyles?.control, size: '18px' } },
  controlPaddingX: '60px',
  controlGap: '8px',
  components: {
    ...glow.components,
    button: {
      ...glow.components?.button,
      variants: {
        ...glow.components?.button?.variants,
        outline: {
          border: 'accent',
          borderWidth: '2px',
          text: 'text',
          hover: { fill: 'accent-hover', border: 'accent-hover', text: 'on-accent' },
          active: { fill: 'accent-active', border: 'accent-active', text: 'on-accent' },
        },
      },
    },
  },
};

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
 * The one column the whole page keeps to: 960px of content, inset 40px (22px on a phone). The
 * header, the hero's words, its film and every section share its two edges, so nothing reaches past
 * the rest. The site's hero is a wider box than its sections, and its film narrower than the hero, so
 * its header seemed to run on to the right of everything under it; one column is what reads as
 * balanced.
 */
const PAGE_BOX = { width: '100%', maxWidth: '1040px', px: '22px', smUpProps: { px: '40px' } };

/**
 * The site's header, over the top of the hero: the logo and name, its two papers, Discord, and AD4M
 * on GitHub with its stars. The papers go below the site's tablet width and Discord below its phone
 * width, as on the site; the nearest of the app's widths stand in for the site's 1000px and 600px.
 *
 * It keeps to the page's column, so the logo stands over the eyebrow and the pill ends over the film's
 * right edge. The site's header is a wider box than its hero, and sits 20px out of line on each side.
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
      props: { ...PAGE_BOX, height: '120px', ax: 'between', ay: 'center' },
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

/**
 * A film as the site frames one: a 16:9 box with the poster in it until somebody presses it, then
 * the player in the same box, so nothing under it moves. `playing` names the local that says which.
 *
 * The hero's poster carries its play button bottom left with the caption beside it; the app's has a
 * smaller one in the middle and the caption along the bottom — both as on the site.
 */
function filmFrame(
  film: { src: string; poster: string; captions: string },
  caption: string,
  playing: string,
  hero: boolean,
): SchemaNode {
  const playButton: SchemaNode = {
    type: 'Row',
    props: {
      width: hero ? '72px' : '64px',
      height: hero ? '72px' : '64px',
      r: 'full',
      bg: 'accent',
      ax: 'center',
      ay: 'center',
      flexShrink: 0,
      ring: '0 0 0 10px color-mix(in srgb, var(--we-role-accent) 18%, transparent)',
    },
    // Outlined, as the site's is; the filled triangle read heavier than the rest of the page.
    children: [{ type: 'we-icon', props: { name: 'play', size: hero ? '34px' : '26px', color: 'on-accent' } }],
  };
  const captionText: SchemaNode = {
    type: 'we-text',
    props: { variant: 'label', color: 'text', fontSize: hero ? '17px' : '15px' },
    children: [caption],
  };
  const poster: SchemaNode = {
    type: 'we-button',
    props: {
      variant: 'bare',
      width: '100%',
      height: '100%',
      label: `Play: ${caption}`,
      onClick: { $setLocal: playing, value: true },
    },
    children: [
      {
        type: 'Column',
        props: { position: 'relative', width: '100%', height: '100%' },
        children: [
          // Dimmed until pointed at, brightening over the site's 300ms (the page theme's state
          // duration), and darkened along the bottom so the caption reads, as on the site. Nothing
          // over it takes the pointer, so pointing at the play button still counts as the picture.
          {
            type: 'we-image',
            props: {
              src: film.poster,
              alt: '',
              fit: 'cover',
              width: '100%',
              height: '100%',
              opacity: 0.75,
              hoverProps: { opacity: 1 },
              // Fading back as well as up. Leaving a state snaps in the design system, which is right
              // for a run of small controls a pointer crosses; this is one large picture, and the
              // site fades it both ways. Its own transition is the resting one, so the departure.
              transition: 'opacity var(--we-theme-state-duration, 300ms) ease-out',
            },
          },
          {
            type: 'Column',
            props: {
              position: 'absolute',
              top: hero ? '55%' : '60%',
              left: '0',
              right: '0',
              bottom: '0',
              bgImage: `linear-gradient(180deg, rgba(13,15,38,0), rgba(13,15,38,${hero ? '.75' : '.8'}))`,
              pointerEvents: 'none',
            },
          },
          hero
            ? {
                type: 'Row',
                props: {
                  position: 'absolute',
                  left: '600',
                  bottom: '500',
                  gap: '400',
                  ay: 'center',
                  pointerEvents: 'none',
                },
                children: [playButton, captionText],
              }
            : {
                type: 'Column',
                props: {
                  position: 'absolute',
                  top: '0',
                  left: '0',
                  right: '0',
                  bottom: '0',
                  ax: 'center',
                  ay: 'center',
                  pointerEvents: 'none',
                },
                children: [
                  playButton,
                  {
                    type: 'Row',
                    props: { position: 'absolute', left: '0', right: '0', bottom: '300', ax: 'center' },
                    children: [captionText],
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
      src: film.src,
      poster: film.poster,
      controls: true,
      autoplay: true,
      playsinline: true,
      preload: 'metadata',
      fit: 'contain',
      width: '100%',
      height: '100%',
      tracks: [{ src: film.captions, srclang: 'en', label: 'English', kind: 'captions', default: true }],
      // Captions from another origin load only over CORS, and asking for it asks for the film the same way.
      crossorigin: 'anonymous',
    },
  };
  return {
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
    children: [{ type: '$if', props: { condition: { $: `local.${playing}` }, then: player, else: poster } }],
  };
}

/** The small grey line under a film. */
const filmMeta = (children: SchemaNode['children']): SchemaNode => ({
  type: 'Row',
  props: { gap: '100', ay: 'center', wrap: true },
  children: [{ type: 'we-text', props: { fontSize: '13px', color: 'text-muted' }, children }],
});

const heroFilm: SchemaNode = {
  type: 'Column',
  // The column's full width, so the film's right edge is the header's.
  props: { width: '100%', gap: '200', mt: '300' },
  children: [
    {
      type: 'we-text',
      props: { tag: 'p', color: 'text-muted', fontSize: '17px', lineHeight: '1.45', maxWidth: '800px' },
      children: [FILM.lead],
    },
    filmFrame(FILM, `The Coasys film · ${FILM.length} · with sound`, 'playing', true),
    {
      type: 'Row',
      props: { gap: '100', ay: 'center', wrap: true },
      children: [
        { type: 'we-text', props: { fontSize: '13px', color: 'text-muted' }, children: ['Captions on ·'] },
        {
          // The site's transcript toggle: mint words, no box.
          type: 'we-button',
          props: {
            variant: 'bare',
            color: 'accent-text',
            fontSize: '13px',
            fontWeight: '600',
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

const hero: SchemaNode = {
  type: 'Column',
  // The site's light, on the hero alone: the page under the sections is plain.
  props: { position: 'relative', width: '100%', ax: 'center', bgImage: HERO_LIGHT },
  children: [
    header,
    {
      type: 'Column',
      // Clear of the header, which sits over the top of the hero as the site's does.
      props: { ...PAGE_BOX, pt: '110px', pb: '56px', gap: '400', mdUpProps: { pt: '124px', pb: '70px' } },
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
              props: { variant: 'solid', size: 'lg', onClick: { $setLocal: 'playing', value: true } },
              // Outlined, as the site's is.
              children: [{ type: 'we-icon', props: { name: 'play', size: '20px' } }, 'Watch the film'],
            },
            {
              type: 'we-button',
              // As on the site: down to what the app is, where its own film and the way in are.
              props: { variant: 'outline', size: 'lg', onClick: { $invoke: 'shellStore.scrollToId', args: ['app'] } },
              children: ['See the app'],
            },
          ],
        },
        heroFilm,
      ],
    },
  ],
};

/** A section's eyebrow and heading, the heading's last words in mint, as the site sets them. */
/** The site's section heading sizes: 30px on a phone, 40px, then 60px. */
const H2_SIZE = { fontSize: '30px', smUpProps: { fontSize: '40px' }, mdUpProps: { fontSize: '60px' } };

const sectionHead = (eyebrow: string, plain: string, mint: string): SchemaNode[] => [
  { type: 'we-text', props: { variant: 'overline', color: 'accent-text', mb: '18px' }, children: [eyebrow] },
  {
    type: 'we-text',
    props: {
      tag: 'h2',
      fontWeight: '300',
      lineHeight: '1.12',
      letterSpacing: '-0.01em',
      maxWidth: '900px',
      mb: '28px',
      ...H2_SIZE,
    },
    // The mint words are part of the heading, so they are set at its sizes: a we-text inside another
    // takes its own size rather than its parent's.
    children: [
      `${plain} `,
      {
        type: 'we-text',
        props: { inline: true, color: 'accent-text', fontWeight: '300', lineHeight: '1.12', ...H2_SIZE },
        children: [mint],
      },
    ],
  },
];

/** How far along a part is: a filled pill when it works, an outline when it is next, dashed in design. */
const statusPill = (status: Status, color = 'text-muted'): SchemaNode => ({
  type: 'we-text',
  props: {
    fontSize: '12px',
    fontWeight: '700',
    letterSpacing: '0.06em',
    uppercase: true,
    color,
    alignSelf: 'flex-start',
    px: '12px',
    py: '3px',
    r: '999px',
    mt: '8px',
    ...(status === STATUS.next
      ? { border: '1px solid rgba(199,201,220,.55)' }
      : status === STATUS.design
        ? { border: '1px dashed rgba(199,201,220,.45)' }
        : { bg: 'rgba(199,201,220,.1)' }),
  },
  children: [status],
});

/** A full-width band with its words in the section measure. */
const section = (id: string, props: Record<string, unknown>, children: SchemaNode[]): SchemaNode => ({
  type: 'Column',
  props: { id, width: '100%', ax: 'center', py: '70px', mdUpProps: { py: '110px' }, ...props },
  children: [{ type: 'Column', props: PAGE_BOX, children }],
});

/**
 * The partners, between the hero and the app. The site draws them dark on a white band; beside this
 * page's indigo that read as a hole, so the band is the page itself, shading from where the hero ends
 * into the violet the app section starts with, and the logos are white.
 */
const partners: SchemaNode = {
  type: 'Column',
  props: { width: '100%', ax: 'center', bgImage: PARTNERS_BAND, pt: '46px', pb: '50px' },
  children: [
    {
      type: 'Column',
      props: { ...PAGE_BOX, ax: 'center', gap: '18px' },
      children: [
        { type: 'we-text', props: { variant: 'overline', color: 'text-muted' }, children: ['Partners'] },
        {
          type: 'Row',
          props: { wrap: true, ax: 'center', ay: 'center', gap: '20px 30px', smUpProps: { gap: '26px 48px' } },
          children: PARTNERS.map((partner) => ({
            type: 'we-link',
            // Quieter than the words around them until the pointer is on one.
            props: { href: partner.href, target: '_blank', display: 'flex', opacity: 0.75, hoverProps: { opacity: 1 } },
            children: [
              {
                type: 'we-image',
                /*
                  White, whatever colours a logo is drawn in: every pixel it paints, at the alpha it
                  paints it. A filter, so the site's files are used as they are.
                */
                styles: { filter: 'brightness(0) invert(1)' },
                props: {
                  // Square: an image takes the theme's media corners, which cut into a logo's edges.
                  r: '0',
                  src: `${SITE}/partners/${partner.name}.svg`,
                  alt: partner.alt ?? partner.name,
                  height: `${Math.round(partner.h * 0.8)}px`,
                  width: 'auto',
                  maxWidth: '130px',
                  fit: 'contain',
                  smUpProps: { maxWidth: '180px' },
                },
              },
            ],
          })),
        },
      ],
    },
  ],
};

const appSection = section('app', { bgImage: APP_WASH }, [
  ...sectionHead('The Coasys app', 'A space for your group', 'and its agents.'),
  {
    type: 'we-text',
    props: {
      color: 'text-muted',
      fontSize: '18px',
      lineHeight: '29px',
      maxWidth: '760px',
      mb: '28px',
      mdUpProps: { fontSize: '22px', lineHeight: '34px' },
    },
    children: ['Three minutes with one team and its AI agents, in the space they share: chat, calls and a board.'],
  },
  // Side by side where both fit, the film the wider, as the site's 1.25fr / 1fr; stacked where not.
  // A wrapping row says that without a breakpoint, which a flex direction cannot change at.
  {
    type: 'Row',
    props: { wrap: true, gap: '36px', mt: '8px', ay: 'start' },
    children: [
      {
        type: 'Column',
        props: { flex: '1.25 1 420px', minWidth: '0', gap: '200' },
        children: [filmFrame(APP_FILM, APP_FILM.caption, 'appPlaying', false), filmMeta(['Captions on'])],
      },
      {
        type: 'Column',
        props: { flex: '1 1 300px', minWidth: '0', gap: '18px' },
        children: APP_POINTS.map((point) => ({
          type: 'Column',
          props: { pl: '18px', borderLeft: '3px solid accent' },
          children: [
            {
              type: 'we-text',
              props: { tag: 'h3', fontSize: '20px', lineHeight: '28px', fontWeight: '500', color: 'text', mb: '4px' },
              children: [point.title],
            },
            {
              type: 'we-text',
              props: { fontSize: '16px', lineHeight: '25px', color: 'text-muted' },
              children: [point.text],
            },
            statusPill(point.status),
          ],
        })),
      },
    ],
  },
  // Where the site asks for an email for its waitlist, the app has the thing itself.
  {
    type: 'Row',
    props: { mt: '36px' },
    children: [
      {
        type: 'we-button',
        props: { variant: 'solid', size: 'lg', onClick: { $invoke: 'shellStore.closeShellView', args: [] } },
        children: ['Open your spaces'],
      },
    ],
  },
]);

/**
 * One layer, as the site draws it: the whole card is the link to the layer's page, and it is ringed
 * in the layer's colour under the pointer.
 */
const layerCard = (layer: (typeof LAYERS)[number]): SchemaNode => ({
  type: 'we-link',
  props: {
    href: layer.href,
    target: '_blank',
    display: 'flex',
    direction: 'column',
    // Three across where each has 260px, one per row on a phone, two and one in between.
    flex: '1 1 260px',
    minWidth: '0',
    r: '16px',
    overflow: 'hidden',
    bg: 'rgba(27,30,69,.7)',
    border: '1px solid border',
    borderTop: `4px solid ${layer.color}`,
    color: 'text',
    textDecoration: 'none',
    hoverProps: { borderColor: layer.color },
  },
  children: [
    {
      type: 'Column',
      props: { position: 'relative', width: '100%' },
      children: [
        {
          type: 'we-image',
          props: { src: layer.still, alt: layer.alt, fit: 'cover', width: '100%', aspectRatio: '16 / 9', opacity: 0.8 },
        },
        {
          type: 'we-text',
          props: {
            position: 'absolute',
            top: '12px',
            left: '12px',
            px: '12px',
            py: '4px',
            r: '999px',
            fontSize: '12px',
            fontWeight: '700',
            letterSpacing: '0.1em',
            uppercase: true,
            color: layer.color,
            bg: 'rgba(13,15,38,.85)',
            border: `1px dashed ${layer.color}`,
          },
          children: ['Film coming'],
        },
      ],
    },
    {
      type: 'Column',
      props: { flex: '1 1 auto', pt: '20px', px: '22px', pb: '22px' },
      children: [
        {
          type: 'we-text',
          props: {
            fontSize: '14px',
            letterSpacing: '0.06em',
            uppercase: true,
            color: 'text-muted',
            mb: '8px',
          },
          children: [
            {
              type: 'we-text',
              props: {
                inline: true,
                fontSize: '22px',
                fontWeight: '700',
                letterSpacing: '0',
                textTransform: 'none',
                color: layer.color,
              },
              children: [layer.name],
            },
            ` · ${layer.role}`,
          ],
        },
        {
          type: 'we-text',
          props: { fontSize: '17px', lineHeight: '27px', color: 'text-muted' },
          children: [layer.line],
        },
        statusPill(layer.status),
        // At the foot of the card, however long its line.
        {
          type: 'we-text',
          props: { mt: 'auto', pt: '18px', fontSize: '16px', fontWeight: '600', color: layer.color },
          children: ['More →'],
        },
      ],
    },
  ],
});

const layersSection = section('layers', {}, [
  ...sectionHead('Underneath', 'Three layers,', 'a short film each.'),
  {
    type: 'Row',
    props: { wrap: true, gap: '22px', mt: '12px', ay: 'stretch' },
    children: LAYERS.map(layerCard),
  },
  // The rest of the site lives on the site: the team, the blog and the community change too often to copy.
  {
    type: 'we-text',
    props: { color: 'text-muted', mt: '36px' },
    children: ['The team, the blog and the open source community are on ', link(SITE, 'coasys.org'), '.'],
  },
]);

export const coasysAbout: TemplateSchema & { id: string } = {
  id: 'about',
  meta: {
    name: 'About Coasys',
    description: 'What Coasys is building, the app it starts with, and the layers underneath',
    icon: 'info',
    role: 'page',
  },
  type: 'Column',
  theme: SITE_THEME,
  $localState: {
    playing: { type: 'boolean', initial: false },
    appPlaying: { type: 'boolean', initial: false },
    transcript: { type: 'boolean', initial: false },
  },
  // The page's colour without the theme's orbs, which are the app's: the hero brings the site's own
  // light, and the sections below it are plain, as the site's are.
  props: { width: '100%', minHeight: '100%', bg: 'page', bgImage: 'none', ax: 'center' },
  children: [hero, partners, appSection, layersSection],
};
