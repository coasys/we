/**
 * The person's own Motion setting stops movement, as their system's does.
 *
 * It only zeroed the theme's transition tokens, so anything carrying a duration of its own — a
 * template's fade or reveal, a keyframe — carried on. Choosing Reduced now marks the document, and
 * the rule that stops every transition and animation under the system preference applies there too.
 */
export const name = 'reduced motion from the app';
export const scenario = 'blank';
export const widths = [300];

export async function check({ evaluate }) {
  const out = await evaluate(async () => {
    const { applyThemeVars, clearThemeVars, setDisplayPreferences } = window.__harness.themeApi;
    const root = document.documentElement;
    const box = document.createElement('div');
    // A duration of its own, not a token — what the tokens alone could never reach.
    box.style.transition = 'opacity 700ms ease';
    document.getElementById('mount').appendChild(box);
    const read = () => getComputedStyle(box).transitionDuration;

    applyThemeVars(root, {}, { crossFade: false });
    const full = read();
    setDisplayPreferences({ motion: 'reduced' });
    await new Promise((r) => setTimeout(r, 50));
    const reduced = read();
    const marked = root.getAttribute('data-we-motion');
    setDisplayPreferences({});
    await new Promise((r) => setTimeout(r, 50));
    const back = read();
    box.remove();
    clearThemeVars(root);
    root.removeAttribute('data-we-motion');
    return { full, reduced, back, marked };
  });
  const problems = [];
  if (out.marked !== 'reduced') problems.push(`the document is not marked (${out.marked})`);
  if (out.reduced === out.full) problems.push(`a 700ms transition is still ${out.reduced} with Motion set to Reduced`);
  if (out.back !== out.full) problems.push(`full motion did not come back (${out.back})`);
  return problems;
}
