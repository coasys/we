/**
 * The theme tools as a host calls them: one call at a time, each given the record as it is stored
 * now. Pinned here: refusals come back as text, an update is a merge that keeps what it was not told
 * about, the vocabulary is the registry's, and what an update returns is what the app's save writes.
 */
import { THEME_SETTINGS } from '@we/themes/presets';
import { describe, expect, it } from 'vitest';

import type { RecordInput } from '../src/core/toolset';
import { THEME_READ, THEME_UPDATE, themeToolset } from '../src/themes/themeToolset';
import { toolsets } from '../src/toolsets';

const base64 = (text: string) => {
  const bytes = new TextEncoder().encode(text);
  return btoa(String.fromCharCode(...bytes));
};
const decode = (file: unknown) => {
  const binary = atob((file as { data_base64: string }).data_base64);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
};

const stored = { accentHue: 160, roles: { page: 'oklch(98% 0.01 278)', surface: 'var(--we-role-page)' } };

/** The record as a host reads it: each file resolved to the data URI the app reads it as. */
const record = (properties: Record<string, unknown> = {}): RecordInput => ({
  id: 'theme-1',
  className: 'Theme',
  properties: {
    name: 'Meadow',
    version: 4,
    overrides: `data:application/json;base64,${base64(JSON.stringify(stored))}`,
    css: `data:text/css;base64,${base64('we-button::part(base) { letter-spacing: 0.02em; }')}`,
    ...properties,
  },
});

const update = (args: unknown) => themeToolset.call(THEME_UPDATE, { record: record(), args });

describe('the theme tools', () => {
  it('are offered to a host as `theme`, for Theme records', () => {
    expect(toolsets.theme).toBe(themeToolset);
    expect(themeToolset.appliesTo).toEqual(['Theme']);
  });

  it('read the name, version, settings and CSS', async () => {
    const answer = JSON.parse((await themeToolset.call(THEME_READ, { record: record(), args: {} })).text);
    expect(answer).toMatchObject({ name: 'Meadow', version: 4, overrides: { accentHue: 160 } });
    expect(answer.css).toContain('letter-spacing');
  });

  it('merge settings, keeping the roles they were not told about, and save as the app does', async () => {
    const answer = await update({
      version: 4,
      overrides: { saturation: 40, roles: { surface: null, text: 'var(--we-role-accent)' } },
    });
    expect(answer.text).toMatch(/^Saved as version 5/);
    expect(answer.properties?.version).toBe(5);
    expect(answer.properties).not.toHaveProperty('css');
    const written = JSON.parse(decode(answer.properties?.overrides));
    expect(written).toMatchObject({
      accentHue: 160,
      saturation: 40,
      roles: { page: 'oklch(98% 0.01 278)', text: 'var(--we-role-accent)' },
    });
    expect(written.roles).not.toHaveProperty('surface');
    expect(written.schemaVersion).toEqual(expect.any(Number));
    expect(answer.properties?.overrides).toMatchObject({ name: 'overrides.json', file_type: 'application/json' });
  });

  it('remove a setting given as null', async () => {
    const answer = await update({ version: 4, overrides: { accentHue: null } });
    expect(JSON.parse(decode(answer.properties?.overrides))).not.toHaveProperty('accentHue');
  });

  it('replace the CSS, and remove it when given none', async () => {
    const answer = await update({ version: 4, css: 'we-card::part(base) { outline: 1px dashed; }' });
    expect(decode(answer.properties?.css)).toContain('dashed');
    expect((await update({ version: 4, css: '' })).properties?.css).toBeNull();
  });

  it('refuse a theme that has changed since it was read', async () => {
    const answer = await update({ version: 3, overrides: { saturation: 40 } });
    expect(answer.text).toMatch(/^Error: The theme has changed/);
    expect(answer.properties).toBeUndefined();
  });

  it('refuse a setting that does not exist, naming the ones that do', async () => {
    const answer = await update({ version: 4, overrides: { primaryHue: 200 } });
    expect(answer.text).toMatch(/^Error: `primaryHue` is not a theme setting/);
    for (const key of Object.keys(THEME_SETTINGS)) expect(answer.text).toContain(key);
  });

  it('refuse a value the vocabulary does not allow', async () => {
    const answer = await update({ version: 4, overrides: { polarity: 'sideways' } });
    expect(answer.text).toMatch(/^Error: .*polarity/);
  });

  it('refuse CSS the app would drop, saying why', async () => {
    expect((await update({ version: 4, css: "@import 'https://e.example/x.css';" })).text).toMatch(/^Error: `@import`/);
    expect((await update({ version: 4, css: 'a { background: url(https://e.example/p.png) }' })).text).toMatch(
      /^Error: `url\(\)`/,
    );
    // A data: URL is bytes, not a request.
    expect((await update({ version: 4, css: 'a { background: url(data:image/png;base64,AAAA) }' })).text).toMatch(
      /^Saved/,
    );
  });

  it('serve the theming reference as their documentation', async () => {
    expect(await themeToolset.docs.list()).toEqual([expect.objectContaining({ path: 'theme' })]);
    const text = await themeToolset.docs.read('theme');
    expect(text).toContain(THEME_UPDATE);
    for (const key of Object.keys(THEME_SETTINGS)) expect(text).toContain('`' + key + '`');
  });
});
