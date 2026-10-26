/**
 * Coasys: the Coasys app, as a cartridge WE runs.
 *
 * A whitelabel, not a fork. Everything that makes it Coasys is here, as data: its name, mark and
 * About page; its sign-in screen; its theme; the chrome around every space (one rail, no module
 * rail); and a space laid out as one tree and one view. A deployment builds it in by naming it in its
 * seed — `seeds/coasys.seed.json` — and anybody can install it from its file.
 *
 * Built from Josh's chrome and identity designs and Nico's d12 mockups for the inside of a space.
 */
import type { Cartridge } from '../cartridge.ts';
import { coasysApp } from './app.ts';
import { coasysBootScreen } from './boot.ts';
import { coasysBrand } from './brand.ts';
import { coasysSpace } from './space/shell.ts';
import { coasysTheme, glowTheme } from './themes.ts';

export const coasys: Cartridge = {
  id: 'coasys',
  name: 'Coasys',
  description: 'Your community’s conversations, calls and the work that comes out of them, on devices you run.',
  app: coasysApp,
  shell: coasysSpace,
  sections: [],
  // Nico's look leads: what a new Coasys space and the app wear until somebody chooses.
  theme: glowTheme,
  // Josh's, with a light and a dark side, to switch to in Appearance.
  themes: [coasysTheme],
  brand: coasysBrand,
  bootScreen: coasysBootScreen,
  shapes: [],
  modules: ['call', 'transcribe', 'graph'],
  // Every space a member opens in Coasys is drawn as a Coasys space.
  display: 'ours',
  sample: {
    space: { name: 'October pilot', description: 'Planning the October pilot with the Riverside team' },
    agents: [],
    records: [],
    route: '/space/preview-coasys',
  },
};
