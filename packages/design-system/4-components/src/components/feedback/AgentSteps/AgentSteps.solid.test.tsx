/**
 * What a reply's steps say about a call that wrote: the word "wrote", not only the tint — and a
 * disclosure that says out loud whether it is open.
 */
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { AgentSteps } from './AgentSteps.solid';
import type { AgentStep } from './AgentSteps.types';

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
});

function mount(steps: AgentStep[], running = false) {
  host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <AgentSteps steps={steps} running={running} />, host);
  return host;
}

describe('a step that wrote', () => {
  it('says "wrote" in words beside its mark — a read step does not', () => {
    mount(
      [
        { tool: 'instance_create', outcome: 'ok', wrote: true },
        { tool: 'describe_perspective', outcome: 'ok' },
      ],
      false,
    );
    // A settled reply keeps its steps folded — unfold as a reader would.
    (host!.querySelector('we-button') as HTMLElement).click();
    expect(host!.textContent).toContain('wrote');
    const rows = host!.querySelectorAll('we-text');
    const wroteRow = [...rows].find((el) => el.textContent?.includes('wrote'))!;
    expect(wroteRow.textContent).toContain('Created a record');
    // The read step beside it says nothing of the kind.
    const readRow = [...rows].find((el) => el.textContent?.includes('Looked at'))!;
    expect(readRow.textContent).not.toContain('wrote');
  });
});

describe('the steps disclosure', () => {
  it('answers aria-expanded, matching what the caret says', () => {
    mount([{ tool: 'instance_query', outcome: 'ok' }], false);
    const toggle = host!.querySelector('we-button') as HTMLElement;
    // Settled and folded: closed until asked for.
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
