import { BASE_CLASS_LAYERS, designSystemKeys, getKeysForLayers } from '@we/design-utils';

const DESIGN_SYSTEM_PROPS = Object.fromEntries(designSystemKeys.map((key) => [key, `DesignSystemProps['${key}']`]));

const DS_BASE_CLASSES = new Set(Object.keys(BASE_CLASS_LAYERS));

export default {
  globs: ['src/**/*.ts'],
  // Analyzer 0.11.0 started defaulting `packagejson` to true, which writes a `customElements`
  // field into package.json pointing at the manifest. Off here: `custom-elements.json` is
  // gitignored and this package declares no `files`, so npm falls back to .gitignore and the
  // manifest is never published — the field would name a file consumers do not receive. It also
  // makes `pnpm build` dirty the tree, which CI's "generated files are committed" step fails on.
  // Publishing the manifest is a deliberate decision, not a side effect of a devDependency bump.
  packagejson: false,
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
