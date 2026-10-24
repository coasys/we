/**
 * The theme lab under every theme a checked-in bundle carries — Coasys and Glow among them.
 *
 * The contrast suite holds these themes to its pairs; this is where they are looked at. Run with
 * `WE_BROWSER_ONLY=themeLabBundles WE_BROWSER_SHOTS=<dir>` and each is photographed. The one check is
 * the lab's own: a danger button is not drawn in the accent.
 */
export const name = 'theme lab under every bundle theme';
export const scenario = 'theme:lab-bundle';
export const widths = [1100];
/** Indexes into BUNDLE_LAB_THEMES in scenarios.ts — one per theme side the bundles carry. */
export const scales = [0, 1, 2, 3, 4, 5];

let run = 0;

export async function check({ partStyle, screenshot }) {
  const index = run++;
  await screenshot(`bundle-lab-${index}`);
  const solidAccent = await partStyle('we-button', 'background-color', 'base', 4);
  const solidDanger = await partStyle('we-button', 'background-color', 'base', 16);
  return solidAccent === solidDanger ? [`theme ${index}: the danger button is drawn in the accent`] : [];
}
