/**
 * What `we-alert` says to a screen reader, what it leads with, and whose corners it has.
 *
 * It was an assertive alert whatever it said, so a note inside a dialog — "Starts as a Coasys
 * space" — was read out over the dialog's own title the moment it opened. And its icon was its
 * tone's, always, so a note about an app could only lead with "info".
 */
import './alert';

import { describe, expect, it } from 'vitest';

import { componentCascadeFor } from '../shared/helpers';

interface AlertEl extends HTMLElement {
  tone?: string;
  icon: string;
  updateComplete: Promise<unknown>;
}

async function mount(attrs: { tone?: string; icon?: string }) {
  const el = document.createElement('we-alert') as AlertEl;
  if (attrs.tone) el.setAttribute('tone', attrs.tone);
  if (attrs.icon) el.icon = attrs.icon;
  el.textContent = 'Something to say';
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

const base = (el: AlertEl) => el.shadowRoot!.querySelector('[part="base"]')!;

describe('we-alert', () => {
  it('interrupts for a warning or a danger, and waits its turn for anything else', async () => {
    expect(base(await mount({ tone: 'warning' })).getAttribute('role')).toBe('alert');
    expect(base(await mount({ tone: 'danger' })).getAttribute('role')).toBe('alert');
    expect(base(await mount({ tone: 'neutral' })).getAttribute('role')).toBe('status');
    expect(base(await mount({})).getAttribute('role')).toBe('status');
  });

  it('leads with the icon it is given, and with its tone’s otherwise', async () => {
    const given = await mount({ tone: 'neutral', icon: 'app-window' });
    expect(base(given).querySelector('we-icon')!.getAttribute('name')).toBe('app-window');
    const own = await mount({ tone: 'warning' });
    expect(base(own).querySelector('we-icon')!.getAttribute('name')).toBe('warning');
  });

  // Pinned because a box drawn by hand to look like one took the control family's shape instead —
  // a pill under Coasys Glow — and the alert is what such a box should be.
  it('takes its corners from the surface family, as a card does', () => {
    expect(componentCascadeFor('alert')?.radiusGroup).toBe('--we-theme-surface-radius');
  });
});
