/**
 * Behaviour verification for the write-tracking in `helpers.ts` `setProperty`.
 *
 * That change skips `removeProperty` for custom properties an element never wrote, which is what
 * takes flush from ~681ms to ~192ms on a 3006-element tree. Removing a property that was never set
 * is a no-op by definition, so the change should be invisible — these cases prove it, including the
 * two names where a primitive writes a custom property directly AND helpers.ts generates the same
 * name (`--we-spinner-color`, `--we-markdown-gap`).
 *
 * NOTE ON LOCATION: this belongs in @we/primitives, but that package has no test infrastructure at
 * all — nor do @we/components, @we/design-utils or @we/tokens. It sits here because this is the
 * nearest home already wired for happy-dom + primitives, and because leaving a shipped behaviour
 * change with no test anywhere is worse. Move it when @we/primitives gets a test setup.
 */
import '@we/primitives';

import { describe, expect, it } from 'vitest';

type LitEl = HTMLElement & { updateComplete?: Promise<unknown> };

async function mount(tag: string, props: Record<string, unknown> = {}): Promise<LitEl> {
  const el = document.createElement(tag) as LitEl;
  for (const [k, v] of Object.entries(props)) (el as unknown as Record<string, unknown>)[k] = v;
  document.body.appendChild(el);
  if (el.updateComplete) await el.updateComplete;
  return el;
}

/** Inline custom properties currently set on the element. */
function customProps(el: HTMLElement): string[] {
  const style = el.getAttribute('style') ?? '';
  return style
    .split(';')
    .map((d) => d.split(':')[0]?.trim())
    .filter((n) => !!n && n.startsWith('--'));
}

describe('setProperty write-tracking', () => {
  it('still writes a custom property when a DS prop is set', async () => {
    const el = await mount('we-text', { color: 'neutral-800' });
    const props = customProps(el);
    expect(props.length).toBeGreaterThan(0);
    expect(el.getAttribute('style')).toContain('color');
    el.remove();
  });

  it('still clears a custom property that WAS previously written', async () => {
    const el = (await mount('we-text', { color: 'neutral-800' })) as LitEl & { color?: string };
    const before = el.getAttribute('style') ?? '';
    expect(before).toContain('color');

    // Clearing must still remove it — this is the path write-tracking has to keep working.
    el.color = '';
    if (el.updateComplete) await el.updateComplete;

    const after = el.getAttribute('style') ?? '';
    expect(after.includes('--we-text-color')).toBe(false);
    el.remove();
  });

  it('leaves no custom properties on an element with no DS props set', async () => {
    const el = await mount('we-text');
    expect(customProps(el)).toEqual([]);
    el.remove();
  });

  it('survives repeated set/clear/set cycles', async () => {
    const el = (await mount('we-text', { color: 'neutral-800' })) as LitEl & { color?: string };
    for (let i = 0; i < 3; i++) {
      el.color = '';
      if (el.updateComplete) await el.updateComplete;
      expect((el.getAttribute('style') ?? '').includes('--we-text-color')).toBe(false);

      el.color = 'primary-500';
      if (el.updateComplete) await el.updateComplete;
      expect(el.getAttribute('style') ?? '').toContain('--we-text-color');
    }
    el.remove();
  });

  // --- Collision cases: primitive writes the var directly, helpers.ts generates the same name ---

  it('does not clobber --we-markdown-gap written directly by we-markdown', async () => {
    const el = await mount('we-markdown', { content: '# hi', markdownGap: '12px' });
    expect(el.getAttribute('style') ?? '').toContain('--we-markdown-gap');
    el.remove();
  });

  it('does not clobber --we-spinner-color written directly by we-spinner', async () => {
    const el = await mount('we-spinner', { color: 'primary-500' });
    expect(el.getAttribute('style') ?? '').toContain('--we-spinner-color');
    el.remove();
  });
});
