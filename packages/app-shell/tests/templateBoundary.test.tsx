/**
 * A template that throws must not take the app with it.
 *
 * Solid's default for an uncaught throw during render is to unmount the whole tree, and WE had no
 * `ErrorBoundary` anywhere — so any error inside a template blanked the window, chrome and all,
 * including the settings that would have let you switch to a different one. That default is bad in
 * any app and worse here, because the thing that throws is data somebody else wrote and syncs in
 * with a space you merely visited.
 */
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TemplateBoundary } from '../src/frameworks/solid/components/TemplateBoundary';

let host: HTMLDivElement;
let dispose: () => void;

function Throws(): never {
  throw new Error('Cannot read properties of undefined');
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  // The boundary logs the real error; the test asserts on what the user sees, not on the console.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  dispose?.();
  host.remove();
  vi.restoreAllMocks();
});

describe('when a template throws', () => {
  it('renders a message instead of nothing', () => {
    dispose = render(() => <TemplateBoundary what="this space's template">{Throws()}</TemplateBoundary>, host);

    expect(host.textContent).toContain("Something went wrong in this space's template");
  });

  it('shows what went wrong, so it can be reported and fixed', () => {
    dispose = render(() => <TemplateBoundary what="this space's template">{Throws()}</TemplateBoundary>, host);

    expect(host.textContent).toContain('Cannot read properties of undefined');
  });

  it('keeps everything outside the boundary mounted — the whole point', () => {
    dispose = render(
      () => (
        <>
          <div id="chrome">sidebar</div>
          <TemplateBoundary what="this space's template">{Throws()}</TemplateBoundary>
        </>
      ),
      host,
    );

    expect(host.querySelector('#chrome')?.textContent).toBe('sidebar');
  });

  it('offers the caller a way out alongside the retry', () => {
    // The retry alone is not a recovery: a render error is almost always deterministic in its
    // inputs, so the escape hatch is what actually gets the user unstuck.
    dispose = render(
      () => (
        <TemplateBoundary what="this space's template" action={<button id="escape">Choose another</button>}>
          {Throws()}
        </TemplateBoundary>
      ),
      host,
    );

    expect(host.querySelector('#escape')).not.toBeNull();
  });

  it('logs the error rather than swallowing it', () => {
    dispose = render(() => <TemplateBoundary what="settings">{Throws()}</TemplateBoundary>, host);

    expect(console.error).toHaveBeenCalled();
  });
});

describe('when nothing throws', () => {
  it('is invisible', () => {
    dispose = render(
      () => (
        <TemplateBoundary what="this space's template">
          <div id="content">the template</div>
        </TemplateBoundary>
      ),
      host,
    );

    expect(host.querySelector('#content')?.textContent).toBe('the template');
    expect(host.textContent).not.toContain('Something went wrong');
  });
});
