/**
 * `we-textarea`'s `rows`.
 *
 * It was passed to the inner element all along and then overridden in CSS: a hard `min-height` of
 * 80px is about three lines, so any value below the default rendered at three rows and read as the
 * prop being ignored.
 */
import { describe, expect, it } from 'vitest';

import Textarea from './textarea';

describe('rows', () => {
  it('reaches the element that renders them', async () => {
    const el = document.createElement('we-textarea') as HTMLElement & {
      rows: number;
      updateComplete: Promise<unknown>;
    };
    el.rows = 1;
    document.body.appendChild(el);
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('textarea')?.getAttribute('rows')).toBe('1');
  });

  it('is floored at one control height, not at three rows', () => {
    const sheet = (Textarea.styles as unknown as { cssText: string }[]).map((s) => s.cssText).join('\n');
    const rule = /\[part='textarea'\]\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? '';
    expect(rule).toContain('min-height: var(--we-component-height-md)');
    expect(rule).not.toContain('min-height: 80px');
  });
});
