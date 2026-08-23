/**
 * `applyThemeVars` tests.
 *
 * The interesting behaviour is what it *removes*. Switching themes has to clear the previous theme's
 * variables and nothing else — the root is shared, and a host publishes layout variables there too.
 * The shortcut (`style.cssText = ''`) passes any test that only checks the new theme applied, and
 * silently deletes the host's own state, which is how a docked panel's chrome ends up snapped to the
 * window edge until something forces a recompute.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_PRESETS } from './presets';
import { applyThemeVars, themeParametersToStyle } from './themeStyles';

/** A minimal stand-in for an element's inline style, so this needs no DOM. */
function fakeRoot() {
  const props = new Map<string, string>();
  return {
    props,
    el: {
      style: {
        setProperty: (name: string, value: string) => props.set(name, value),
        removeProperty: (name: string) => props.delete(name),
      },
    } as unknown as HTMLElement,
  };
}

describe('applyThemeVars', () => {
  it('writes a theme as custom properties', () => {
    const { el, props } = fakeRoot();
    applyThemeVars(el, { polarity: 'dark', lightnessFloor: '12%' });

    // Authored as a percentage, emitted unitless — see the note in themeParametersToStyle.
    expect(props.get('--we-color-lightness-floor')).toBe('0.12');
    // `polarity` is one authored word that expands to the two numbers the ramp multiplies by.
    expect(props.get('--we-color-ramp-direction')).toBe('-1');
  });

  it('clears variables the previous theme set and this one does not', () => {
    const { el, props } = fakeRoot();
    applyThemeVars(el, { primaryHue: 230, polarity: 'dark' });
    expect(props.has('--we-color-primary-hue')).toBe(true);

    applyThemeVars(el, { polarity: 'light' });

    expect(props.has('--we-color-primary-hue')).toBe(false);
    expect(props.get('--we-color-ramp-direction')).toBe('1');
  });

  it('leaves variables it never set alone', () => {
    // The bug this exists to prevent: a host publishes layout state on the same root, and clearing
    // wholesale takes it with the old theme.
    const { el, props } = fakeRoot();
    props.set('--we-dock-right', '320px');

    applyThemeVars(el, { polarity: 'dark' as const });
    applyThemeVars(el, { polarity: 'light' as const });

    expect(props.get('--we-dock-right')).toBe('320px');
  });

  it('tracks each root separately', () => {
    // A page and a space-scoped subtree are both themed; neither may clear the other's variables.
    const a = fakeRoot();
    const b = fakeRoot();
    applyThemeVars(a.el, { primaryHue: 230 });
    applyThemeVars(b.el, { polarity: 'dark' as const });
    applyThemeVars(b.el, { polarity: 'light' as const });

    expect(a.props.has('--we-color-primary-hue')).toBe(true);
  });
});

/**
 * The cross-fade window.
 *
 * `--we-theme-switch-duration` is the one seam that lets a theme change animate the same properties a
 * hover exit uses, without a hover exit ever inheriting a duration from it. Both halves matter and
 * both are easy to break silently: leave it set and every button trails on the way out again; never
 * set it and a light/dark switch becomes a repaint.
 *
 * The first-application case is the one that already went wrong once. Opening the window on initial
 * paint is not a switch — there is nothing to fade *from* — and it left every component running a
 * 250ms departure transition for the first fraction of a second of the page's life, which was long
 * enough to be sampled and reported as the exact fault the variable exists to avoid.
 */
describe('applyThemeVars cross-fade window', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const DURATION = '--we-theme-switch-duration';

  it('does not open a window on the first application, which is the initial paint', () => {
    const { el, props } = fakeRoot();
    applyThemeVars(el, { polarity: 'dark' as const });

    expect(props.has(DURATION)).toBe(false);
  });

  it('opens one on a later application, when there is something to fade from', () => {
    const { el, props } = fakeRoot();
    applyThemeVars(el, { polarity: 'dark' as const });
    applyThemeVars(el, { polarity: 'light' as const });

    expect(props.get(DURATION)).toBe('250ms');
  });

  it('closes the window afterwards, so a hover exit never inherits a duration', () => {
    const { el, props } = fakeRoot();
    applyThemeVars(el, { polarity: 'dark' as const });
    applyThemeVars(el, { polarity: 'light' as const });

    vi.advanceTimersByTime(400);
    expect(props.has(DURATION)).toBe(false);
  });

  /*
    An edit is not a switch, and conflating them is what made the theme editor feel broken.

    The editor re-applies on every frame of a slider drag. Each application re-armed the window, so
    anything whose background animates — every primitive, the primary button most visibly — spent
    the drag transitioning toward a colour that had already moved again. Beside it, plain text and
    the focus ring updated instantly, because they do not animate. It read as the colour derivations
    being slow; it was a 250ms fade being restarted sixty times a second.
  */
  it('does not open a window when the caller says this is an edit rather than a switch', () => {
    const { el, props } = fakeRoot();
    applyThemeVars(el, { polarity: 'dark' as const });
    applyThemeVars(el, { polarity: 'dark' as const, primaryHue: 200 }, { crossFade: false });

    expect(props.has(DURATION)).toBe(false);
  });

  it('still opens one for a switch, which is what the window is for', () => {
    const { el, props } = fakeRoot();
    applyThemeVars(el, { polarity: 'dark' as const });
    applyThemeVars(el, { polarity: 'light' as const }, { crossFade: true });

    expect(props.get(DURATION)).toBe('250ms');
  });

  it('restarts the window when a second switch lands mid-fade, rather than closing early', () => {
    const { el, props } = fakeRoot();
    applyThemeVars(el, { polarity: 'dark' as const });
    applyThemeVars(el, { polarity: 'light' as const });

    vi.advanceTimersByTime(300);
    applyThemeVars(el, { polarity: 'dark' as const });

    // The first switch's timer would have fired by now had it not been cleared.
    vi.advanceTimersByTime(200);
    expect(props.get(DURATION)).toBe('250ms');

    vi.advanceTimersByTime(200);
    expect(props.has(DURATION)).toBe(false);
  });

  it('tracks the window per root, so two subtrees do not close each other', () => {
    const a = fakeRoot();
    const b = fakeRoot();
    applyThemeVars(a.el, { polarity: 'dark' as const });
    applyThemeVars(a.el, { polarity: 'light' as const });
    applyThemeVars(b.el, { polarity: 'dark' as const });

    expect(a.props.get(DURATION)).toBe('250ms');
    expect(b.props.has(DURATION)).toBe(false);
  });
});

describe('a named theme brings its own parameters', () => {
  /*
    The second half of the scoped-named-theme gap. `{ themeName: 'cyberpunk' }` re-declared the
    colour *formulas* but left their *inputs* — multiplier, subtractor, saturation — inherited from
    whatever theme was ambient. A cyberpunk section inside a light app therefore got cyberpunk's
    shapes over light's lightness curve, and only looked right when the app already happened to be
    on that theme.
  */
  it('resolves a known name to its preset parameters', () => {
    const style = themeParametersToStyle({ themeName: 'cyberpunk' });
    const preset = THEME_PRESETS.cyberpunk.parameters;

    expect(style['--we-color-lightness-floor']).toBe(String(parseFloat(preset.lightnessFloor!) / 100));
    expect(style['--we-color-lightness-ceiling']).toBe(String(parseFloat(preset.lightnessCeiling!) / 100));
    expect(style['--we-color-saturation']).toBe(String(preset.saturation));
  });

  it('lets an explicit override win over the preset', () => {
    // `{ themeName: 'cyberpunk', primaryHue: 320 }` should read as "cyberpunk, different accent".
    const style = themeParametersToStyle({ themeName: 'cyberpunk', primaryHue: 320 });

    expect(style['--we-color-primary-hue']).toBe('320');
    expect(style['--we-color-lightness-floor']).toBe(
      String(parseFloat(THEME_PRESETS.cyberpunk.parameters.lightnessFloor!) / 100),
    );
  });

  it('leaves an unknown name alone rather than inventing parameters', () => {
    // A marketplace theme's id is not a preset key; its inputs come from its own CSS.
    const style = themeParametersToStyle({ themeName: 'some-installed-theme' });
    expect(style['--we-color-lightness-floor']).toBeUndefined();
  });

  it('still re-declares the formulas, which is what it always did', () => {
    const style = themeParametersToStyle({ themeName: 'cyberpunk' });
    expect(style['--we-color-lightness-500']).toContain('var(--we-color-lightness-floor)');
  });
});

describe('color-scheme follows the lightness polarity', () => {
  /*
    The UA's own widgets — the time picker's popup, scrollbars, native dropdowns — are coloured
    for color-scheme and nothing else. A dark theme that never said so got light-scheme widgets:
    a white time picker floating over a dark panel.
  */
  it('declares dark when the multiplier inverts the scale', () => {
    expect(themeParametersToStyle({ themeName: 'dark' })['color-scheme']).toBe('dark');
    expect(themeParametersToStyle({ polarity: 'dark' as const })['color-scheme']).toBe('dark');
  });

  it('declares light when it does not', () => {
    expect(themeParametersToStyle({ themeName: 'light' })['color-scheme']).toBe('light');
  });

  it('stays silent when the theme leaves the polarity alone, inheriting the ambient scheme', () => {
    expect(themeParametersToStyle({ primaryHue: 320 })['color-scheme']).toBeUndefined();
  });
});

describe('roles resolve against the theme they belong to', () => {
  /*
    A custom property containing var() is substituted where it is *declared*. The tokens CSS
    declares the role defaults at :root, so a role left unpinned computes against :root's colours
    and inherits downward as a finished value — which is invisible for the document theme and wrong
    for every other application of one. A scoped space theme could redeclare each colour token on
    its wrapper and still paint its unpinned surfaces from the personal theme's scale.
  */
  it('re-declares every role default, so an unpinned role follows this theme', () => {
    const style = themeParametersToStyle({ polarity: 'dark' as const });
    expect(style['--we-role-text-muted']).toBe('var(--we-color-neutral-600)');
    // The elevation stack is a relationship, not a scale position — and it has to be re-declared
    // for the same reason, or a scoped theme's cards are measured off the ambient theme's page.
    expect(style['--we-role-surface']).toBe('oklch(from var(--we-role-page) calc(l + 0.045) c h)');
  });

  it('lets a pin win over the default it replaces, rather than sitting beside it', () => {
    const style = themeParametersToStyle({ roles: { surfaceRaised: 'var(--we-color-neutral-100)' } });
    expect(style['--we-role-surface-raised']).toBe('var(--we-color-neutral-100)');
  });

  it('carries the pins a named preset brings with it', () => {
    /*
      `channels` is a reproduction of a real chat client, measured rather than designed by eye, and
      its surfaces are uneven in a way no single lightness range can express — page and cards
      identical, the rail further out. That is what a pin is *for*, so it is the honest example here.

      It used to be `black`, on the reasoning that a page at the sRGB floor leaves no room for a
      derived step. That was true and the floor was wrong: it had been mistranslated from an HSL
      lightness to an OKLCH one, putting the page at literal #000000 rather than the rgb(11,10,15)
      it used to render. Refitting the ramp gave the relationship its room back and the four pins
      went with it — so a test asserting that `black` pins was asserting a defect.

      Asserted as "it pins a lightness" rather than as one exact string: the numbers are a design
      decision that moves, and a test repeating them only says the file was copied correctly. That
      the *ordering* holds is checked in contrast.test.ts, which is the property that matters.
    */
    const raised = themeParametersToStyle({ themeName: 'channels' })['--we-role-surface-raised'];
    expect(raised).toMatch(/^oklch\(\d/);
  });
});

describe('the shape, density and typography keys added alongside the roles editor', () => {
  it('maps avatarRadius to its own group, separate from surfaces', () => {
    const style = themeParametersToStyle({ avatarRadius: '0', surfaceRadius: '16px' });
    expect(style['--we-theme-avatar-radius']).toBe('0');
    expect(style['--we-theme-surface-radius']).toBe('16px');
  });

  it('maps inputPadding, which nothing could set before', () => {
    expect(themeParametersToStyle({ inputPadding: '4px 8px' })['--we-theme-input-padding']).toBe('4px 8px');
  });

  it('maps headingFontFamily without touching the body face', () => {
    const style = themeParametersToStyle({ headingFontFamily: "'Boldonse', serif" });
    expect(style['--we-theme-heading-font-family']).toBe("'Boldonse', serif");
    expect(style['--we-font-family']).toBeUndefined();
  });
});

describe('a preset and a theme both pinning roles', () => {
  /*
    `roles` is the one override that merges rather than replaces. A shallow spread meant pinning a
    single role on a preset that pins its own threw the rest away: editing the accent on `channels`
    dropped the twelve measured surface and text pins that make it that theme, and it came apart
    from one click in the colour picker.
  */
  it('keeps the preset’s pins for roles the theme does not mention', () => {
    const style = themeParametersToStyle({ themeName: 'channels', roles: { accent: '#ff0000' } });
    /*
      Asserted as "three distinct pins survived" rather than as three exact lightnesses. The numbers
      moved once already, when the ramp went to OKLCH and every hand-measured percentage had to be
      converted — and a test that repeats them only ever says the file was copied correctly. What
      must not happen is that pinning one role drops the others.
    */
    // `text-muted` is no longer pinned here — it is derived against the surface now — so the three
    // roles asserted are ones this theme still states for itself.
    for (const role of ['--we-role-page', '--we-role-surface-sunken', '--we-role-surface-raised']) {
      expect(style[role], `${role} was dropped`).toMatch(/^oklch\([\d.]+%/);
    }
    expect(
      new Set([style['--we-role-page'], style['--we-role-surface-sunken'], style['--we-role-text-muted']]).size,
    ).toBe(3);
  });

  it('still lets the theme win on the role it does pin', () => {
    expect(themeParametersToStyle({ themeName: 'channels', roles: { accent: '#ff0000' } })['--we-role-accent']).toBe(
      '#ff0000',
    );
  });

  it('leaves a theme with no roles of its own exactly as the preset had it', () => {
    const bare = themeParametersToStyle({ themeName: 'channels' });
    const withOther = themeParametersToStyle({ themeName: 'channels', primaryHue: 100 });
    expect(withOther['--we-role-page']).toBe(bare['--we-role-page']);
  });
});
