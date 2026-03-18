import { designSystemKeys, getKeysForLayers } from '@we/design-utils';

const DESIGN_SYSTEM_PROPS = Object.fromEntries(designSystemKeys.map((key) => [key, `DesignSystemProps['${key}']`]));

// Map of base class names to their DS layer sets
const BASE_CLASS_LAYERS = {
  DesignSystemElement: ['layout', 'visual', 'flex', 'typography', 'state'],
  OverlayElement: ['layout', 'visual', 'flex', 'typography', 'state'],
  LayoutElement: ['layout'],
  LayoutTypographyElement: ['layout', 'typography'],
  LayoutVisualElement: ['layout', 'visual'],
  LayoutVisualTypographyElement: ['layout', 'visual', 'typography'],
};

const DS_BASE_CLASSES = new Set(Object.keys(BASE_CLASS_LAYERS));

export default {
  globs: ['src/**/*.ts'],
  plugins: [
    {
      name: 'inject-design-system-props',
      analyzePhase({ moduleDoc }) {
        const declarations = moduleDoc?.declarations;
        if (!declarations) return;

        for (const decl of declarations) {
          if (decl.kind !== 'class' || !decl.superclass) continue;
          const superName = decl.superclass.name;
          if (!DS_BASE_CLASSES.has(superName)) continue;

          const layers = BASE_CLASS_LAYERS[superName];
          const activeKeys = getKeysForLayers(layers);

          decl.members ??= [];
          decl.attributes ??= [];
          for (const key of activeKeys) {
            if (decl.members.some((m) => m.name === key)) continue;
            const typeText = DESIGN_SYSTEM_PROPS[key];
            if (typeText) {
              decl.members.push({ kind: 'field', name: key, type: { text: typeText }, privacy: 'public' });
              decl.attributes.push({ name: key, type: { text: typeText }, fieldName: key });
            }
          }
        }
      },
    },
  ],
};
