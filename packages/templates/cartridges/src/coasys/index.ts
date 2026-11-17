/**
 * Coasys: the Coasys app, as a cartridge WE runs.
 *
 * A whitelabel, not a fork. Everything that makes it Coasys is here, as data: its name, mark and
 * About page (the first screen of coasys.org, film and all); its sign-in screen; its theme; the chrome around every space (one rail, no module
 * rail); and a space laid out as one tree and one view. A deployment builds it in by naming it in its
 * seed — `seeds/coasys.seed.json` — and anybody can install it from its file.
 *
 * Built from Josh's chrome and identity designs and Nico's d12 mockups for the inside of a space.
 */
import type { Cartridge } from '../cartridge.ts';
import { coasysAbout } from './about.ts';
import { coasysApp } from './app.ts';
import { coasysBootScreen } from './boot.ts';
import { coasysBrand } from './brand.ts';
import { coasysSpace } from './space/shell.ts';
import { coasysStarter } from './starter.ts';
import { coasysTheme, glowTheme } from './themes.ts';

export const coasys: Cartridge = {
  id: 'coasys',
  name: 'Coasys',
  description: 'Your community’s conversations, calls and the work that comes out of them, on devices you run.',
  app: coasysApp,
  shell: coasysSpace,
  sections: [],
  pages: [coasysAbout],
  // Nico's look leads: what a new Coasys space and the app wear until somebody chooses.
  theme: glowTheme,
  // Josh's, with a light and a dark side, to switch to in Appearance.
  themes: [coasysTheme],
  brand: coasysBrand,
  bootScreen: coasysBootScreen,
  shapes: [],
  modules: ['call', 'transcribe', 'feed', 'graph'],
  // Every space a member opens in Coasys is drawn as a Coasys space.
  display: 'ours',
  // A space made while in Coasys is a Coasys space: its template, Glow, its vocabulary, a canvas.
  starters: [coasysStarter],
  sample: {
    space: {
      name: 'October pilot',
      description: 'Planning the October pilot with the Riverside team',
      /*
        The space collection, which `createSpace` would make as `Space.root`: the canvas's members
        scope to its children, so a sample without it photographs an empty canvas.
      */
      root: 'coasys-root',
    },
    agents: [
      { did: 'did:agent:pilot-mara', firstName: 'Mara', handle: 'mara' },
      { did: 'did:agent:pilot-devon', firstName: 'Devon', handle: 'devon' },
    ],
    signalTypes: [{ name: 'Agree', slug: 'agree', icon: 'thumbs-up' }],
    records: [
      // The space collection: root and canvas are its children, as `writeSpaceStructure` leaves them.
      {
        entity: 'CollectionBlock',
        id: 'coasys-root',
        fields: { kind: 'channel', mode: 'feed', title: '' },
        relations: {
          children: ['coasys-canvas', 'card-brief', 'card-pilot', 'card-venue', 'card-invites'],
        },
      },
      // The canvas itself, named by the landmark the shell reads as `spaceStore.landmarks.canvas`.
      // Its children are the placements — the canvas's membership.
      {
        entity: 'CollectionBlock',
        id: 'coasys-canvas',
        fields: { kind: 'canvas', mode: 'feed', title: 'Pilot canvas' },
        relations: { children: ['pl-brief', 'pl-pilot', 'pl-venue', 'pl-invites'] },
      },
      {
        entity: 'SpaceLandmark',
        id: 'coasys-landmark-canvas',
        fields: { name: 'canvas' },
        relations: { node: 'coasys-canvas' },
      },
      // The cards — the space collection's children; a placement each puts them on the canvas.
      {
        entity: 'CollectionBlock',
        id: 'card-brief',
        fields: {
          kind: 'card',
          mode: 'feed',
          title: 'Write the pilot brief',
          textContent: 'One page: who, what, when, how we will know it worked.',
        },
        relations: { signals: ['sig-brief-1', 'sig-brief-2'] },
        createdAt: '2025-09-08T09:12:00Z',
      },
      {
        entity: 'CollectionBlock',
        id: 'card-pilot',
        fields: {
          kind: 'card',
          mode: 'feed',
          title: 'Run the October pilot',
          textContent: 'Three weeks with the Riverside team, weekly check-ins.',
        },
        relations: { signals: ['sig-pilot-1'] },
        createdAt: '2025-09-08T09:30:00Z',
      },
      {
        entity: 'CollectionBlock',
        id: 'card-venue',
        fields: {
          kind: 'card',
          mode: 'feed',
          title: 'Book the workshop room',
          textContent: 'Riverside annex, holds twelve, whiteboards on two walls.',
        },
        createdAt: '2025-09-09T14:05:00Z',
      },
      {
        entity: 'CollectionBlock',
        id: 'card-invites',
        fields: {
          kind: 'card',
          mode: 'feed',
          title: 'Send the invites',
          textContent: 'Ten seats: six Riverside, four of us.',
        },
        createdAt: '2025-09-10T10:41:00Z',
      },
      // Placements — children of the canvas, one per card, holding the freeform coordinates.
      {
        entity: 'Placement',
        id: 'pl-brief',
        fields: { nodeType: 'CollectionBlock', x: 60, y: 40, rank: 1 },
        relations: { node: 'card-brief' },
      },
      {
        entity: 'Placement',
        id: 'pl-pilot',
        fields: { nodeType: 'CollectionBlock', x: 520, y: 60, rank: 2 },
        relations: { node: 'card-pilot' },
      },
      {
        entity: 'Placement',
        id: 'pl-venue',
        fields: { nodeType: 'CollectionBlock', x: 420, y: 280, rank: 3 },
        relations: { node: 'card-venue' },
      },
      {
        entity: 'Placement',
        id: 'pl-invites',
        fields: { nodeType: 'CollectionBlock', x: 80, y: 300, rank: 4 },
        relations: { node: 'card-invites' },
      },
      // Who agreed — the voices a signal order weighs.
      {
        entity: 'Signal',
        id: 'sig-brief-1',
        fields: { signalTypeId: 'coasys-signal-agree', value: 1 },
        author: 'did:agent:pilot-mara',
      },
      {
        entity: 'Signal',
        id: 'sig-brief-2',
        fields: { signalTypeId: 'coasys-signal-agree', value: 1 },
        author: 'did:agent:pilot-devon',
      },
      {
        entity: 'Signal',
        id: 'sig-pilot-1',
        fields: { signalTypeId: 'coasys-signal-agree', value: 1 },
        author: 'did:agent:pilot-mara',
      },
      // The kind of connection the tree follows as its spine, and the claims made in it.
      { entity: 'RelationshipType', id: 'rel-leads-to', fields: { name: 'leads to', slug: 'leads-to' } },
      {
        entity: 'Relationship',
        id: 'rel-1',
        fields: {
          relationshipTypeId: 'rel-leads-to',
          sourceType: 'CollectionBlock',
          targetType: 'CollectionBlock',
          connection: 'Write the pilot brief → Run the October pilot: leads to',
        },
        relations: { source: 'card-brief', target: 'card-pilot' },
      },
      {
        entity: 'Relationship',
        id: 'rel-2',
        fields: {
          relationshipTypeId: 'rel-leads-to',
          sourceType: 'CollectionBlock',
          targetType: 'CollectionBlock',
          connection: 'Write the pilot brief → Send the invites: leads to',
        },
        relations: { source: 'card-brief', target: 'card-invites' },
      },
      {
        entity: 'Relationship',
        id: 'rel-3',
        fields: {
          relationshipTypeId: 'rel-leads-to',
          sourceType: 'CollectionBlock',
          targetType: 'CollectionBlock',
          connection: 'Run the October pilot → Book the workshop room: leads to',
        },
        relations: { source: 'card-pilot', target: 'card-venue' },
      },
    ],
    route: '/space/preview-coasys?view=canvas',
  },
};
