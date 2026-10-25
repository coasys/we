/**
 * `tone: 'accent'` restores the theme's own accent, not the vocabulary's.
 *
 * It used to write the accent's default definitions, so inside another tone it dropped whatever the
 * theme had pinned or corrected — Coasys Glow's tint came back as the generic dark green, and Dark's
 * pinned accent as the default one. Each theme root now holds its accent where a tone cannot reach.
 */
export const name = "tone: 'accent' restores the theme's accent";
export const scenario = 'tone:held-accent';
export const widths = [600];

export async function check({ evaluate }) {
  const out = await evaluate(() => {
    const fill = (id) => {
      const button = document.getElementById(id);
      const base = button?.shadowRoot?.querySelector('[part~="base"]');
      return base ? getComputedStyle(base).backgroundColor : null;
    };
    return { plain: fill('plain'), restored: fill('restored') };
  });
  const problems = [];
  if (out.plain !== 'rgb(18, 52, 86)') problems.push(`the theme's pinned tint is not drawn at all (${out.plain})`);
  if (out.restored !== out.plain)
    problems.push(`inside a purple tone, tone: 'accent' draws ${out.restored} rather than the theme's ${out.plain}`);
  return problems;
}
