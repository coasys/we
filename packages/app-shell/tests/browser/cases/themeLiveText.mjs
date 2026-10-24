/**
 * Text keeps its corrected colour while a theme slider is held.
 *
 * A held slider re-applies the theme each frame without measuring it, keeping what was last
 * measured. Muted and faint text are among what is measured — corrected for contrast — and the
 * defaults written each frame used to replace those corrections, so every line of muted text in the
 * app dimmed for the length of a drag and came back when the slider was let go.
 */
export const name = 'text holds still under a held slider';
export const scenario = 'blank';
export const widths = [300];

export async function check({ evaluate }) {
  const out = await evaluate(() => {
    const { applyThemeVars, clearThemeVars, setThemeLive } = window.__harness.themeApi;
    const root = document.getElementById('mount');
    const read = (role) => {
      const probe = document.createElement('div');
      probe.style.color = `var(--we-role-${role})`;
      root.appendChild(probe);
      const colour = getComputedStyle(probe).color;
      probe.remove();
      return colour;
    };
    const roles = ['text', 'text-muted', 'text-faint'];
    applyThemeVars(root, { themeName: 'dark', accentHue: 200 }, { crossFade: false });
    const measured = roles.map(read);
    setThemeLive(true);
    applyThemeVars(root, { themeName: 'dark', accentHue: 220 }, { crossFade: false });
    const held = roles.map(read);
    setThemeLive(false);
    clearThemeVars(root);
    return roles.map((role, i) => ({ role, measured: measured[i], held: held[i] }));
  });
  // Lightness, which is what dimming is: the greys follow the accent's hue in `dark`, so the hue
  // moving with the slider is the theme working.
  const lightness = (colour) => parseFloat(/oklch\(([\d.]+)/.exec(colour)?.[1] ?? 'NaN');
  return out
    .filter((r) => Math.abs(lightness(r.measured) - lightness(r.held)) > 0.005)
    .map((r) => `${r.role} is ${r.held} while held, ${r.measured} measured`);
}
