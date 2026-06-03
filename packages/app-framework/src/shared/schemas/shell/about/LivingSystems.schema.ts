import type { TemplateSchema } from '@we/schema-shared';

// Rainbow spectrum: Violet (centre) → Indigo → Blue → Green → Yellow → Orange → Red
// Outer ring runs clockwise from top so adjacent colours are adjacent in the spectrum.

const FEATURES = [
  {
    name: 'Coordinator', // 'Regulator', // 'Coordination Centre',
    icon: 'brain',
    color: '#983eff',
    description: 'Stores information, makes decisions, and coordinates the system. Nucleus → Brain → Government.',
  },
  {
    name: 'Circulator', // 'Material Transport',
    icon: 'drop',
    color: '#ff3e68', // #3eff4e',
    description:
      'Moves resources, nutrients, fuel, and waste through the system. Cytoplasm → Circulatory system → Roads & supply chains.',
  },
  {
    name: 'Transmitter', // 'Information Transport',
    icon: 'pulse',
    color: '#3e71ff', // #3ee2ff',
    description:
      'Moves signals and coordination information throughout the system. Signal transduction → Nervous system → Internet.',
  },
  {
    name: 'Membrane', // 'Boundary',
    icon: 'wall',
    color: '#3ee2ff', // '#3e71ff',
    description: 'Defines self vs. outside and controls what enters and exits. Cell membrane → Skin → Border.',
  },

  {
    name: 'Guardian', // 'Immune System', 'Senitnel
    icon: 'shield-checkered',
    color: '#3eff4e', // '#ff3e68',
    description:
      'Protects the system, removes threats, and clears waste. Lysosomes → Immune system → Military & sanitation.',
  },
  {
    name: 'Digestor', // 'Digestion',
    icon: 'cookie',
    color: '#fff533',
    description: 'Breaks down inputs and generates usable energy. Mitochondria → Digestive system → Power plants.',
  },
  {
    name: 'Assembler', // 'Builder', // 'Assembler', //  'Assembly',
    icon: 'hammer',
    color: '#ffb23e',
    description: "Builds, repairs, and maintains the system's structures. Ribosomes → Organs → Factories.",
  },

  // {
  //   name: 'Circulator', // 'Material Transport',
  //   icon: 'package',
  //   color: '#ff3e68', // #3eff4e',
  //   description:
  //     'Moves resources, nutrients, fuel, and waste through the system. Cytoplasm → Circulatory system → Roads & supply chains.',
  // },
];

export const livingSystemsTemplate: TemplateSchema = {
  meta: { name: 'Living Systems', description: 'Fractal patterns in living systems', icon: 'hexagon' },
  type: 'Column',
  props: { width: '100%', minHeight: '100%', bg: 'neutral-50', ax: 'center' },
  children: [
    {
      type: 'Column',
      props: { px: '500', py: '800', gap: '500', maxWidth: '1100px', width: '100%' },
      children: [
        // Back button
        {
          type: 'Row',
          props: { mb: '200' },
          children: [
            {
              type: 'we-button',
              props: {
                text: '← Back to about',
                variant: 'ghost',
                onClick: { $action: 'templateStore.openShellView', args: ['landing-page'] },
              },
            },
          ],
        },

        // Hero
        {
          type: 'Column',
          props: { gap: '400', ax: 'center', mb: '800' },
          children: [
            { type: 'we-icon', props: { name: 'hexagon', size: '64px', gradient: 'primary' } },
            {
              type: 'we-text',
              props: {
                fontSize: '52px',
                fontWeight: 'bold',
                color: 'neutral-900',
                textAlign: 'center',
                lineHeight: '1.15',
              },
              children: ['Fractal patterns in living systems'],
            },
            {
              type: 'we-text',
              props: {
                fontSize: '22px',
                color: 'neutral-600',
                textAlign: 'center',
                maxWidth: '700px',
                lineHeight: '1.7',
              },
              children: [
                'The same seven functional patterns appear at every scale of life — from a single cell to an entire city. The names change. The pattern does not.',
              ],
            },
          ],
        },

        // Hexagon diagram
        {
          type: 'Column',
          props: { ax: 'center', ay: 'center', mb: '800' },
          children: [
            {
              type: 'HexagonGrid',
              props: { features: FEATURES, size: 540 },
            },
          ],
        },

        // The seven patterns
        {
          type: 'Column',
          props: { gap: '400', mb: '800' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '700', fontWeight: 'bold', color: 'neutral-900', mb: '200' },
              children: ['The seven patterns'],
            },
            ...FEATURES.map((feature) => ({
              type: 'Row',
              props: {
                gap: '400',
                ay: 'center',
                r: '400',
                p: '400',
                bg: 'neutral-100',
                border: '1px solid var(--we-color-neutral-200)',
              },
              children: [
                { type: 'we-icon', props: { name: feature.icon, size: '32px', gradient: 'primary' } },
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '500', fontWeight: 'bold', color: 'neutral-800' },
                      children: [feature.name],
                    },
                    {
                      type: 'we-text',
                      props: { fontSize: '400', color: 'neutral-600', lineHeight: '1.6' },
                      children: [feature.description],
                    },
                  ],
                },
              ],
            })),
          ],
        },

        // Close button
        {
          type: 'Row',
          props: { ax: 'center', mt: '400' },
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
