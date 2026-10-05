/**
 * A field guide: a naturalist group's species and sightings, on a map.
 *
 * Chosen to be unlike WE's own templates. Nothing in it is a post; it is built on two kinds of thing
 * the cartridge defines itself (`Species`, `Sighting`), reaches for the globe and media, and its
 * chrome reads as a notebook rather than a social space.
 */
import type { Cartridge } from '../cartridge.ts';
import { agents, records, sightingShape, speciesShape } from './model.ts';
import { mapSection, sightingsSection, speciesSection } from './sections.ts';
import { fieldGuideShell } from './shell.ts';

export const fieldGuide: Cartridge = {
  id: 'field-guide',
  name: 'Field Guide',
  description: 'Species and sightings for a naturalist group, on a map.',
  shell: fieldGuideShell,
  sections: [speciesSection, sightingsSection, mapSection],
  theme: {
    id: 'field-guide-moss',
    name: 'Moss',
    icon: 'leaf',
    overrides: {
      polarity: 'light',
      lightnessFloor: '10%',
      lightnessCeiling: '100%',
      primaryHue: 150,
      saturation: 55,
      neutralSaturation: 18,
      surfaceRadius: '10px',
    },
  },
  shapes: [speciesShape, sightingShape],
  modules: ['globe'],
  sample: {
    space: { name: 'Levels Naturalists', description: 'Species and sightings across the Somerset Levels' },
    agents,
    records,
    route: '/space/preview-field-guide/species',
  },
};
