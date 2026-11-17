/*
  `theme-shot.html?theme=<id>&templateUrl=<same-origin>` — a template under one named theme,
  nothing else. Made for the renderer comparison harness
  (`crates/renderer/scripts/theme-compare.sh`): it loads a schema file, applies the theme the
  way `ThemeStore.applyThemeToDOM` does — `data-we-theme`, `applyThemeVars`, the theme's own
  `css` — and renders through the same `RenderSchema` + component registry as `?bare=1`.

  Dev-server only: vite's build input is `index.html`, so this entry never reaches `dist/`.
  Keyframe namespacing (`cssNamespace` in ThemeStore) is skipped on purpose — one theme lives
  here per page load, so there is nothing for its animations to collide with.
*/
import '@we/app-shell/shared/index.scss';

import { componentRegistry, isValidThemeKey, themeRegistry } from '@we/app-shell/solid';
import { applyThemeVars, type ThemeOverrides } from '@we/schema-shared';
import { RenderSchema } from '@we/schema-solid';
import { render } from 'solid-js/web';

import { bareNode, type ExternalTemplate } from './bare';

const params = new URLSearchParams(window.location.search);

const themeId = params.get('theme') ?? 'dark';
const templateUrl = params.get('templateUrl');
if (!templateUrl) throw new Error('[theme-shot] missing templateUrl');

const fail = (error: string) => {
  (window as unknown as Record<string, unknown>).__themeShot = { error };
};

const res = await fetch(new URL(templateUrl, window.location.href));
if (!res.ok) {
  fail(`templateUrl answered ${res.status}`);
  throw new Error(`[theme-shot] ${templateUrl} answered ${res.status}`);
}
const template = (await res.json()) as ExternalTemplate;

// Bundle themes enter the registry under their bundle's namespace (`coasys--glow`), while the
// conformance vectors and the Rust galleries name them bare (`glow`). Try both.
const entry = themeRegistry[themeId] ?? themeRegistry[`coasys--${themeId}`];
if (!entry) {
  fail(`unknown theme ${themeId}`);
  throw new Error(`[theme-shot] unknown theme ${themeId}`);
}

// Mirrors ThemeStore.applyThemeToDOM: attribute for the [data-we-theme='X'] CSS selectors,
// parameters as inline vars, then the theme's own stylesheet.
const overrides: ThemeOverrides = { ...(entry.overrides ?? {}) };
if (overrides.fontFamily === 'base') delete overrides.fontFamily;
const registryId = themeRegistry[themeId] ? themeId : `coasys--${themeId}`;
const baseName =
  overrides.themeName && isValidThemeKey(overrides.themeName)
    ? overrides.themeName
    : isValidThemeKey(registryId)
      ? registryId
      : 'light';
document.documentElement.setAttribute('data-we-theme', baseName);
applyThemeVars(document.documentElement, overrides);
if (entry.css) {
  const style = document.createElement('style');
  style.id = 'we-theme-shot-css';
  style.textContent = entry.css;
  document.head.appendChild(style);
}

const { node, path } = bareNode(template, params.get('route'));
const release = document.createElement('style');
release.textContent = 'html, body, #root { height: auto !important; min-height: 100%; overflow: visible !important; }';
document.head.appendChild(release);

render(
  () => (
    <RenderSchema node={{ type: '$surface', children: [node] } as never} stores={{}} registry={componentRegistry} />
  ),
  document.getElementById('root')!,
);
(window as unknown as Record<string, unknown>).__themeShot = { theme: themeId, baseName, path };
