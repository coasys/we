/**
 * Guards the ladder's equivalence.
 *
 * The four ladder rungs only mean something if they render the same content. Nothing about the
 * code enforces that — `wcCard` lives in fixtures.ts and the three hand-written controls
 * reimplement it in controls.tsx, so an edit to one silently invalidates every published ratio
 * while still looking entirely plausible. These tests make that failure loud.
 *
 * Runs in CI via `pnpm test`. The timing benchmarks deliberately do not.
 */
import '@we/primitives';

import { RenderSchema } from '@we/schema-solid';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import {
  HandWrittenCards,
  HandWrittenCardsPropBound,
  PlainSolidCards,
  RawDomCards,
  RealisticCards,
  RealisticCardsPropBound,
} from '../src/controls';
import { benchStore, cardGrid, fixtures, LADDER_COUNT, REALISTIC_COUNT, wcCard } from '../src/fixtures';
import { registry } from '../src/registry';

const stores = { benchStore };
let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

function mount(el: () => unknown) {
  host = document.createElement('div');
  document.body.appendChild(host);
  dispose = render(el as never, host);
  return host;
}

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

/**
 * Rendered text, descending into shadow roots.
 *
 * Plain `textContent` cannot compare the rungs: `we-text` and `we-button` render their content
 * inside a shadow root, so the light DOM of the design-system rungs is empty while the raw-DOM and
 * plain-Solid rungs put their text in ordinary spans. Walking shadow roots puts all four on the
 * same footing.
 */
function text(root: ParentNode): string {
  let out = '';
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent ?? '';
    else if (node instanceof Element) {
      if (node.shadowRoot) out += text(node.shadowRoot);
      out += text(node);
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

describe('ladder equivalence', () => {
  /**
   * Mount a rung, let Lit finish, read its text and element counts, unmount.
   *
   * The `updateComplete` await is required, not defensive: Lit renders on a microtask, so a
   * synchronous read finds every design-system rung empty and the comparison passes or fails for
   * the wrong reason.
   */
  async function probe(el: () => unknown) {
    const host = mount(el);
    await Promise.all(
      Array.from(host.querySelectorAll('*'))
        .map((n) => (n as Element & { updateComplete?: Promise<unknown> }).updateComplete)
        .filter(Boolean),
    );
    const all = Array.from(host.querySelectorAll('*'));
    const out = {
      text: text(host),
      elements: all.length,
      custom: all.filter((n) => n.tagName.includes('-')).length,
    };
    dispose?.();
    host.remove();
    dispose = undefined;
    return out;
  }

  const schemaRung = () => <RenderSchema node={cardGrid(LADDER_COUNT, wcCard)} stores={stores} registry={registry} />;

  it('all five rungs render identical content', async () => {
    const rungs = {
      'raw DOM': await probe(RawDomCards),
      'plain Solid': await probe(PlainSolidCards),
      'hand-written + DS': await probe(HandWrittenCards),
      'hand-written + DS, prop:': await probe(HandWrittenCardsPropBound),
      'WE templates': await probe(schemaRung),
    };

    // Sanity: the fixture actually rendered 100 cards, so an all-empty match cannot pass.
    expect(rungs['raw DOM'].text).toContain('WC 1');
    expect(rungs['raw DOM'].text).toContain(`Action ${LADDER_COUNT}`);

    // The invariant: every rung is compared against the others, not against a hand-written string
    // that could itself be wrong.
    for (const [name, r] of Object.entries(rungs)) {
      expect(r.text, `${name} renders the same content as raw DOM`).toBe(rungs['raw DOM'].text);
    }
  });

  it('the design-system rungs mount the same custom elements', async () => {
    const hand = await probe(HandWrittenCards);
    const propBound = await probe(HandWrittenCardsPropBound);
    const schema = await probe(schemaRung);

    // The prop: rung must be structurally identical to the attribute one, or it is measuring less
    // work rather than the same work bound differently — which would read as a spurious win.
    expect(propBound.custom).toBe(hand.custom);
    expect(propBound.elements).toBe(hand.elements);

    // we-text + we-button per card. Equal counts are what make Flush comparable between the two:
    // the schema rung's extra elements are all wrapper divs, which are not custom elements.
    expect(hand.custom).toBe(LADDER_COUNT * 2);
    expect(schema.custom).toBe(hand.custom);
  });

  it('the schema rung creates roughly twice the elements, all of them wrappers', async () => {
    const hand = await probe(HandWrittenCards);
    const schema = await probe(schemaRung);

    // Documents the renderer's per-node `display: contents` wrapper. If this ratio moves, the
    // renderer's DOM shape changed and the published element counts need revisiting.
    expect(schema.elements).toBeGreaterThan(hand.elements);
    expect(schema.elements / hand.elements).toBeLessThan(2.5);
  });

  // --- the realistic ladder -------------------------------------------------

  const realisticSchemaRung = () => {
    const node = fixtures.find((f) => f.key === 'r-schema')!.node!;
    return <RenderSchema node={node} stores={stores} registry={registry} />;
  };

  it('all three realistic rungs render identical content', async () => {
    const rungs = {
      'hand-written + DS': await probe(RealisticCards),
      'hand-written + DS, prop:': await probe(RealisticCardsPropBound),
      'WE templates': await probe(realisticSchemaRung),
    };

    // Sanity: varied content actually rendered, so an all-empty match cannot pass. The fixture
    // deliberately varies author, body length and badge label per post.
    expect(rungs['hand-written + DS'].text).toContain('Ada Lovelace');
    expect(rungs['hand-written + DS'].text).toContain('Margaret Hamilton');
    expect(rungs['hand-written + DS'].text).toContain('Updated');

    for (const [name, r] of Object.entries(rungs)) {
      expect(r.text, `${name} matches the hand-written rung`).toBe(rungs['hand-written + DS'].text);
    }
  });

  it('the realistic rungs mount the same custom elements', async () => {
    const hand = await probe(RealisticCards);
    const propBound = await probe(RealisticCardsPropBound);
    const schema = await probe(realisticSchemaRung);

    // 12 per post: avatar, 2 text, badge, 2 text, 2 button, 2 icon, 2 text.
    expect(hand.custom).toBe(REALISTIC_COUNT * 12);
    expect(propBound.custom).toBe(hand.custom);
    expect(schema.custom).toBe(hand.custom);
  });
});
