/**
 * A tool library: things neighbours lend, and loans of them.
 *
 * Unlike the field guide on purpose — transactional rather than observational, a sidebar rather than
 * a header, a dark theme rather than a light one — and asks the question the field guide does not:
 * whether a template can create a record linked to another one.
 */
import type { Cartridge } from '../cartridge.ts';
import { agents, itemShape, loanShape, records } from './model.ts';
import { catalogueSection, deskSection, mineSection } from './sections.ts';
import { toolLibraryShell } from './shell.ts';

export const toolLibrary: Cartridge = {
  id: 'tool-library',
  name: 'Tool Library',
  description: 'A neighbourhood lending library: a catalogue, a lending desk, and your loans.',
  shell: toolLibraryShell,
  sections: [catalogueSection, deskSection, mineSection],
  theme: {
    id: 'tool-library-workshop',
    name: 'Workshop',
    icon: 'wrench',
    overrides: {
      polarity: 'dark',
      lightnessFloor: '9%',
      lightnessCeiling: '96%',
      primaryHue: 65,
      saturation: 75,
      neutralSaturation: 10,
      surfaceRadius: '4px',
    },
  },
  shapes: [itemShape, loanShape],
  modules: [],
  sample: {
    space: { name: 'Elm Road Tools', description: 'Borrow it, use it, bring it back' },
    agents,
    records,
    route: '/space/preview-tool-library/catalogue',
  },
};
