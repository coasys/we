/**
 * What `tone` does to an element, and that it undoes itself.
 *
 * A tone re-points the accent's roles on the host, so everything the element draws in the accent —
 * and every slotted child — draws in the family instead. Set on the host as inline variables, which
 * is the one place a variable reaches both the shadow root and the light DOM; that is also why the
 * previous tone's variables have to be taken off by name, or a button toned `danger` and then
 * `success` would keep whatever the second left unset.
 */
import '../primitives/button';
import '../primitives/badge';

import { describe, expect, it } from 'vitest';

type Mounted = HTMLElement & { updateComplete: Promise<unknown>; tone?: string };

const mount = async (tag: string, props: Record<string, unknown> = {}): Promise<Mounted> => {
  const el = document.createElement(tag) as Mounted;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
};

const accent = (el: HTMLElement) => el.style.getPropertyValue('--we-role-accent');

describe('tone', () => {
  it('re-points the accent at the family, with its label and its states', async () => {
    const el = await mount('we-button', { variant: 'solid', tone: 'danger' });
    expect(accent(el)).toBe('var(--we-role-danger)');
    expect(el.style.getPropertyValue('--we-role-on-accent')).toBe('var(--we-role-on-danger)');
    expect(el.style.getPropertyValue('--we-role-accent-hover')).toBe('var(--we-role-danger-hover)');
  });

  it('carries the focus ring with it, since the ring is the accent too', async () => {
    const el = await mount('we-button', { tone: 'teal' });
    expect(el.style.getPropertyValue('--we-ring-color')).toBe('var(--we-role-focus)');
    expect(el.style.getPropertyValue('--we-role-focus')).toBe('var(--we-role-accent)');
  });

  it('sets nothing on an untoned element', async () => {
    const el = await mount('we-button');
    expect(accent(el)).toBe('');
  });

  it('takes its variables back off when the tone changes or goes', async () => {
    const el = await mount('we-badge', { tone: 'danger' });
    el.tone = 'success';
    await el.updateComplete;
    expect(accent(el)).toBe('var(--we-role-success)');
    el.tone = undefined;
    await el.updateComplete;
    expect(accent(el)).toBe('');
    expect(el.style.getPropertyValue('--we-role-on-accent')).toBe('');
  });

  it('leaves a host’s other inline variables alone', async () => {
    const el = await mount('we-badge', { tone: 'danger' });
    el.style.setProperty('--we-shell-width', '240px');
    el.tone = undefined;
    await el.updateComplete;
    expect(el.style.getPropertyValue('--we-shell-width')).toBe('240px');
  });

  it('chooses a badge’s toned look only for a family other than neutral', async () => {
    const toned = await mount('we-badge', { tone: 'warning' });
    const neutral = await mount('we-badge', { tone: 'neutral' });
    const props = (el: Mounted) =>
      (el as unknown as { getInstanceProps(): Record<string, unknown> }).getInstanceProps();
    expect(props(toned).bg).toBe('accent-soft');
    expect(props(neutral).bg).toBe('control-surface');
  });
});
