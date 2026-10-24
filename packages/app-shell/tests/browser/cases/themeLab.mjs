/**
 * The theme lab under every built-in theme: it renders, and the things a theme is meant to move do.
 *
 * Mostly a page to look at — run with `WE_BROWSER_ONLY=themeLab WE_BROWSER_SHOTS=<dir>` and each
 * theme is photographed. The checks are the few that can be read off the page without judgement: a
 * danger button is not drawn in the accent. The graphs need the graph module, which the harness does
 * not register, so they show as missing here and are looked at in the app.
 */
export const name = 'theme lab under every built-in theme';
export const scenario = 'theme:lab';
export const widths = [1100];
/** Indexes into THEME_LAB_THEMES in scenarios.ts. */
export const scales = [0, 1, 2, 3, 4, 5, 6];
const THEMES = ['light', 'dark', 'black', 'cyberpunk', 'retro', 'channels', 'timeline'];

let run = 0;

export async function check({ partStyle, screenshot }) {
  const theme = THEMES[run++ % THEMES.length];
  await screenshot(`theme-lab-${theme}`);
  const problems = [];
  // The first tone row is neutral, the second accent: four buttons a row, solid first.
  const solidAccent = await partStyle('we-button', 'background-color', 'base', 4);
  const solidDanger = await partStyle('we-button', 'background-color', 'base', 16);
  if (solidAccent === solidDanger) problems.push(`${theme}: the danger button is drawn in the accent`);
  return problems;
}
