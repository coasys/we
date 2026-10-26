/**
 * Theming fragment — what a theme can say, for codebase work and theme authoring.
 *
 * Generated, not written: `themingReference()` builds it from the colour-family, theme-setting,
 * type-role, component-key and display-axis registries, so it cannot list a setting that does not
 * exist or miss one that does. Edit the registries, or the prose in `2-themes/src/reference.ts`.
 *
 * In the codebase reference only, not the schema context a template editor sends every turn: a
 * template names roles and tones, which "Design System Props" covers, and the theme tools serve this
 * page to an agent editing a theme.
 */
import { themingReference } from '@we/themes/presets';

export const theming = `${themingReference(2)}

The long form — how a theme becomes CSS, where it reaches, how to extend the system — is
\`docs/architecture/theming.md\`; writing one is \`packages/design-system/2-themes/THEME_AUTHORING.md\`.
`;
