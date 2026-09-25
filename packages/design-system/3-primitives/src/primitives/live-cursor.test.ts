/**
 * What `we-live-cursor` draws, and the two properties a peer's pointer must have.
 *
 * The interesting assertions are not about the arrow. They are that a foreign cursor cannot take a
 * click, and that the colour it is drawn in is the *same* colour as that person's generated avatar —
 * both of which are invisible when wrong. A cursor that swallowed clicks would read as the page being
 * broken near whoever is closest, and two surfaces disagreeing about somebody's colour reads as two
 * different people.
 */
import './live-cursor';

import { describe, expect, it } from 'vitest';

import { seededFill } from '../shared/seededColor';

interface CursorEl extends HTMLElement {
  name: string;
  hash: string;
  image: string;
  color: string;
  updateComplete: Promise<unknown>;
}

async function mount(props: Partial<Pick<CursorEl, 'name' | 'hash' | 'image' | 'color'>> = {}) {
  const el = document.createElement('we-live-cursor') as CursorEl;
  Object.assign(el, props);
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const part = (el: CursorEl, name: string) => el.shadowRoot!.querySelector(`[part="${name}"]`);

/**
 * The component's own stylesheet as text.
 *
 * Asserted this way rather than through `getComputedStyle` because jsdom does not apply `:host` rules
 * to the host element — it reports `auto` for a property the sheet plainly sets — so a computed-style
 * assertion here would be testing jsdom. The same reading `we-popover`, `we-modal` and
 * `we-scroll-area` take for their own host rules.
 */
const cssOf = (tag: string): string => {
  const styles = (customElements.get(tag) as unknown as { styles: { cssText: string }[] }).styles;
  return (Array.isArray(styles) ? styles : [styles]).map((s) => s.cssText).join('\n');
};

describe('we-live-cursor', () => {
  it('never accepts a pointer, so a peer cannot be a hole in the interface', () => {
    const css = cssOf('we-live-cursor');
    // On the host, not on the parts, so nothing slotted in can switch it back on by accident.
    expect(css).toMatch(/:host\s*\{[^}]*pointer-events:\s*none/s);
  });

  it('is a zero-sized origin, so the tip is the coordinate a caller translates to', () => {
    const css = cssOf('we-live-cursor');
    expect(css).toMatch(/:host\s*\{[^}]*width:\s*0/s);
    expect(css).toMatch(/:host\s*\{[^}]*height:\s*0/s);
  });

  it('draws the arrow alone for somebody unidentified', async () => {
    const bare = await mount();
    expect(part(bare, 'arrow')).toBeTruthy();
    // No name and no picture is a real state — a peer whose profile has not arrived — and a chip
    // holding nothing would read as a rendering fault rather than as a wait.
    expect(part(bare, 'label')).toBeNull();

    const named = await mount({ name: 'Ana' });
    expect(part(named, 'label')!.textContent).toContain('Ana');
  });

  it("takes its colour from the hash, matching that person's generated avatar", async () => {
    const el = await mount({ name: 'Ana', hash: 'did:ana' });
    const { bg, fg } = seededFill('did:ana');
    // The strong step is the mark you track; the pale step is the chip behind the name. Both come
    // from the one function the avatar uses, which is the whole point of it being shared.
    expect(part(el, 'arrow')!.getAttribute('style')).toContain(fg);
    expect(part(el, 'label')!.getAttribute('style')).toContain(bg);
    expect(part(el, 'label')!.getAttribute('style')).toContain(fg);
  });

  it('seeds on the id rather than the name, so renaming does not recolour anybody', async () => {
    const before = await mount({ name: 'Ana', hash: 'did:ana' });
    const after = await mount({ name: 'Ana Smith', hash: 'did:ana' });
    expect(part(after, 'arrow')!.getAttribute('style')).toBe(part(before, 'arrow')!.getAttribute('style'));
  });

  it('lets an explicit colour replace the mark, and tints the chip from the theme instead', async () => {
    const el = await mount({ name: 'Playback', color: 'tomato' });
    expect(part(el, 'arrow')!.getAttribute('style')).toContain('tomato');
    // There is no ramp to step along for an arbitrary CSS colour, so the pale half stays the theme's.
    expect(part(el, 'label')!.getAttribute('style')).toContain('var(--we-role-surface)');
  });

  it('drops a picture that will not load rather than showing a broken frame', async () => {
    const el = await mount({ name: 'Ana', hash: 'did:ana', image: 'https://example.invalid/a.png' });
    expect(part(el, 'face')).toBeTruthy();
    part(el, 'face')!.dispatchEvent(new Event('error'));
    await el.updateComplete;
    expect(part(el, 'face')).toBeNull();
    // The name is still perfectly good identification, which is why this is not a fallback glyph.
    expect(part(el, 'label')!.textContent).toContain('Ana');
  });
});
