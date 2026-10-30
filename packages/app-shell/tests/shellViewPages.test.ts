/**
 * A bundle's pages open where the host's own views do: by the id each lands under, and — for the
 * brand's About page — wherever the host offers "About".
 */
import { resolveShellView } from '@solid/layouts/shellViews';
import type { TemplateSchema } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

const about = { id: 'coasys--about', type: 'Column', meta: { name: 'About', role: 'page' } } as TemplateSchema;
const page = (id: string) => (id === about.id ? about : undefined);

describe('a bundle’s pages', () => {
  it('open by the id they landed under', () => {
    expect(resolveShellView('coasys--about', { page })?.()?.schema).toBe(about);
  });

  it('stand in for the host’s About when the brand names one', () => {
    expect(resolveShellView('landing-page', { page, aboutPage: 'coasys--about' })?.()?.schema).toBe(about);
  });

  it('leave the host’s views alone otherwise', () => {
    const landing = resolveShellView('landing-page', { page })?.()?.schema;
    expect(landing).toBeDefined();
    expect(landing).not.toBe(about);
    expect(resolveShellView('settings', { page, aboutPage: 'coasys--about' })?.()?.schema).not.toBe(about);
    expect(resolveShellView('coasys--missing', { page })).toBeNull();
  });
});
