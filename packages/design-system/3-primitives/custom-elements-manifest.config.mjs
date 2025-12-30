import { designSystemKeys } from '@we/design-system-utils';

const DESIGN_SYSTEM_PROPS = Object.fromEntries(designSystemKeys.map((key) => [key, `DesignSystemProps['${key}']`]));

export default {
  globs: ['src/components/**/*.ts'],
  plugins: [
    {
      name: 'inject-design-system-props',
      analyzePhase({ moduleDoc }) {
        const declarations = moduleDoc?.declarations;
        if (!declarations) return;

        // Iterate over declarations and inject design system props where needed
        for (const decl of declarations) {
          // Only process classes that extend DesignSystemElement
          if (decl.kind !== 'class' || decl.superclass.name !== 'DesignSystemElement') continue;

          // Add design system props to the class members
          decl.members ??= [];
          for (const [name, typeText] of Object.entries(DESIGN_SYSTEM_PROPS)) {
            if (decl.members.some((m) => m.name === name)) continue;
            decl.members.push({ kind: 'field', name, type: { text: typeText }, privacy: 'public' });
          }
        }
      },
    },
  ],
};
