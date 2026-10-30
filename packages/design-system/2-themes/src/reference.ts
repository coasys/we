/**
 * The theming reference — what a theme can say, as one page an agent or a person reads.
 *
 * Built from the registries rather than written beside them: the families and palette hues
 * (`families.ts`), the settings (`themeSettings.ts`, each of which must carry a `doc`), the type
 * roles and component keys (`componentTheme.ts`), the surface-image roles and the display axes. So a
 * setting added to the registry is in the reference the next time it is generated, and a setting
 * removed is gone from it — the reference cannot describe a vocabulary that does not exist.
 *
 * The prose around the lists is the model, which changes far more slowly than the lists do. It is
 * served in two places: the generated agent context (`@we/ai-context`) and the theme tools an agent
 * edits a theme with (`@we/agent-tools`). `docs/architecture/theming.md` is the long form for people.
 */
import {
  COMPONENT_THEME_KEYS,
  PALETTE_HUES,
  SEMANTIC_FAMILIES,
  SURFACE_IMAGE_ROLES,
  TYPE_ROLE_KEYS,
  TYPE_ROLES,
} from '@we/tokens';

import { DISPLAY_AXES } from './display';
import { SPECIAL_SETTING_DOCS, THEME_SETTINGS } from './themeSettings';

const code = (name: string): string => '`' + name + '`';
const list = (names: readonly string[]): string => names.map(code).join(', ');

/** The theming reference as Markdown, headed at `level` (2 for a section of a larger document). */
export function themingReference(level = 2): string {
  const h = (depth: number, title: string) => `${'#'.repeat(level + depth)} ${title}`;
  const settings = Object.entries(THEME_SETTINGS).map(([key, setting]) => `- ${code(key)} — ${setting.doc}`);
  const special = Object.entries(SPECIAL_SETTING_DOCS).map(([key, doc]) => `- ${code(key)} — ${doc}`);
  const axes = DISPLAY_AXES.map(
    (axis) => `| ${code(axis.key)} | ${axis.values} | ${axis.system ? 'yes' : 'no'} | ${axis.doc} |`,
  );

  return [
    h(0, 'Theming'),
    '',
    'A theme is an object of settings, not a stylesheet: numbers and names the design system turns into',
    'every colour, shape and kind of text on screen. That is what lets a theme be shared as data, applied',
    'to a template it has never seen, and corrected for contrast wherever it lands.',
    '',
    h(1, 'Three tiers, broad to narrow'),
    '',
    '1. **System settings** — colour families, the palette, type roles, shape and density families,',
    '   elevation, surface images. Most themes stop here.',
    '2. **Components** — one component, or one variant of it, apart from its family, with the same keys',
    "   the families use: `components: { button: { variants: { soft: { borderWidth: '1.5px' } } } }`.",
    '3. **CSS** — effects no setting should express: a clip-path, keyframes, scanlines. Sanitised and',
    '   confined to where the theme applies; it targets public `::part()` names only.',
    '',
    'Reach for the broadest tier that says it. A component override where a family setting would do',
    'leaves every other component in that family behind; CSS where a setting would do opts out of the',
    'contrast corrections and breaks when the component changes.',
    '',
    h(1, 'Colour'),
    '',
    `Semantic families: ${list(SEMANTIC_FAMILIES)}, plus ${code('neutral')} for greys. The palette, for categories`,
    `a community names: ${list(PALETTE_HUES)}. Status uses the semantic families; categories use the palette.`,
    '',
    'Every family has the same roles, so one pattern names them all (kebab-case in a template):',
    '',
    '| Role | What it is |',
    '| --- | --- |',
    '| `<family>` | the solid fill |',
    '| `on-<family>` | text and icons on that fill |',
    '| `<family>-soft` | a tinted fill: a soft badge, a selected row |',
    '| `<family>-text` | the family as text on an ordinary surface |',
    '| `<family>-border` | a border in the family |',
    '| `<family>-hover`, `<family>-active` | the fill under the pointer and pressed |',
    '',
    'Surfaces and text have their own roles — `chrome`, `page`, `surface`, `surface-raised`,',
    '`surface-sunken`, `text`, `text-muted`, `text-faint`, `border`, `border-strong` and the rest —',
    'measured from the page, so they invert with the theme while a fill keeps its own lightness.',
    '',
    'Each family takes `<family>Hue` (an OKLCH angle — blue is 263, not 220), `<family>Saturation` (0–100,',
    "a share of what that hue can hold) and `<family>Lightness` (the fill's lightness). The palette is",
    'tuned as a set through `palette`.',
    '',
    '**`tone` on any element** re-points the accent roles inside it at one family, so everything in it —',
    "buttons, rings, selected rows, `shadow: 'glow'` — follows. `variant` is never a colour: it says how a",
    'component is drawn (`solid`, `soft`, `outline`, `ghost`, `bare`).',
    '',
    '**Pinning a role** (`roles: { surfaceRaised: … }`) overrules what the system derives. Prefer, in order:',
    'leave it unset; another role (`var(--we-role-page)`); a relative colour from one',
    '(`oklch(from var(--we-role-page) calc(l + 0.05) c h)`); a literal only for a brand colour that must not',
    'move. Foregrounds, fills on which no label reads, hover and pressed states and the elevation stack',
    'are corrected when the theme is applied — but only where they are left unset.',
    '',
    h(1, 'Type roles'),
    '',
    `${code('typeStyles')} sets how each kind of text looks: ${list(TYPE_ROLES)}. Each role takes`,
    `${list(Object.keys(TYPE_ROLE_KEYS))} — ${code('color')} is a role name. A role holds no defaults:`,
    'each component keeps the value it had for any key the theme leaves unset.',
    '',
    h(1, 'Components'),
    '',
    `${code('components.<name>')} and ${code('components.<name>.variants.<variant>')} take ${list(COMPONENT_THEME_KEYS)}.`,
    "`<name>` is what the component registers: a primitive's tag without `we-` (`button`, `menu-item`),",
    "a component's own name (`card`). `type` names a type role; `fill`, `text` and `border` name colour",
    'roles. An explicit prop on an element still wins; then the variant, the component, the family, and',
    'the default.',
    '',
    `Either may also take ${code('hover')} and ${code('active')}, each with ${code('fill')}, ${code('text')} and ${code('border')}:`,
    "the colours under the pointer and while pressed — `button: { variants: { outline: { hover: { fill: 'accent', text: 'on-accent' } } } }`.",
    'They replace the colours the component already changes in that state and add no change of their own.',
    '',
    h(1, 'Surfaces and elevation'),
    '',
    `${code('surfaceImages')} lays a gradient over every surface of a kind: ${list(SURFACE_IMAGE_ROLES)}.`,
    'Gradients only — a picture would have to be fetched. `page` and `chrome` stay put while content',
    "scrolls. An element's own `bgImage` is its own picture and replaces the theme's on that element; use",
    '`surfaceImages` for the look of a whole kind of surface, `bgImage` for one thing.',
    '',
    'Shadows are built from the `shadow-color` role; `shadowIntensity` sets how strong they are and',
    "which one a surface rests at, `glowIntensity` how bright `shadow: 'glow'` is.",
    '',
    h(1, 'Modes — the person wins'),
    '',
    'A theme may say how it looks in a mode — its `light` and `dark` sides, its `contrast.more` block —',
    "but which mode is worn is the person's, and it applies over every theme, a space's included.",
    '',
    '| Axis | Values | Follows the system | What it does |',
    '| --- | --- | --- | --- |',
    ...axes,
    '',
    h(1, 'Every setting'),
    '',
    ...settings,
    ...special,
    '',
    h(1, 'What a theme cannot do'),
    '',
    '- **Fetch anything.** `url()` to a network address and `@import` are removed: a theme is installed',
    '  from strangers and a fetch tells a third party who opened the space. Carry a font in `fontFaces`.',
    "- **Reach the app's chrome from a space, unless the person lets it.** A space's theme is confined to",
    "  the space's content, and the sidebar and the app's own screens wear the person's theme — until they",
    '  choose to let a space theme the whole window.',
    '- **Set an exact size per control.** Sizes stay on the shared scale so a theme cannot break a layout;',
    '  `controlHeightOffset`, `spacingScale` and `fontScale` move the scale instead.',
    "- **Override a person's display needs.** Contrast, text size, density and motion are theirs.",
    '- **Invent a role or a component key.** The vocabulary is the registries; a new word is a code change.',
  ].join('\n');
}
