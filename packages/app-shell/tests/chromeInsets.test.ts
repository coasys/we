/**
 * Chrome sits against the content's edges, and does not work out where they are for itself.
 *
 * Four pieces of chrome pin themselves to the window and then correct inwards for whatever has taken
 * the edge: the module rail, the editor's editing bar, and the call module's three bars. Each one
 * used to compose that correction by hand out of `--we-dock-<edge>`, `--we-sidebar-width` and the
 * rail's width — and no two of them composed the same list.
 *
 * The rail summed the dock inset and a panel's title band. The editing bar summed the dock inset and
 * the rail, and had no vertical term at all, so a panel docked along the top simply covered it. The
 * call module's in-call bar composed the sidebar into its centring, while the join prompt that
 * replaces it in the same spot and the problem alert underneath it centred on the *window* and
 * cleared nothing. Three of four wrong, each in an arrangement the other three do not produce, and
 * none of them wrong in a way that reading the code next door would reveal.
 *
 * So the shell publishes the answer — `--we-chrome-left/right/top/bottom`, the same four numbers the
 * content viewport is laid out from, plus `--we-chrome-center-x` for anything centred. This is what
 * holds consumers to it, because the failure is invisible until somebody docks a panel on the one
 * edge nobody tried.
 *
 * Asserted against the schemas themselves rather than a render: where a fixed node pins itself is a
 * static decision, and rendering would only prove it in whatever arrangement the test set up.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { callModule } from '@we/module-call';
import { chromeRail, sidebar } from '@we/template-shell';
import { describe, expect, it } from 'vitest';

const EDGES = ['top', 'right', 'bottom', 'left'] as const;

/** A full-bleed overlay pins every edge at the window and is right to: a scrim covers everything. */
const SPANS_THE_WINDOW = /^0(px|%)?$/;

/** Every `props` in a tree belonging to a node that pins itself to the viewport. */
function fixedNodes(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) fixedNodes(item, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  const record = node as Record<string, unknown>;
  const props = record.props as Record<string, unknown> | undefined;
  if (props?.position === 'fixed') found.push(props);
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') fixedNodes(value, found);
  }
  return found;
}

describe('chrome pinned to the window', () => {
  it.each([
    ['the module rail', chromeRail],
    ['the shell sidebar', sidebar],
    ["the call module's bars", callModule],
  ])('corrects inwards for the content in %s', (_name, tree) => {
    const pinned = fixedNodes(tree);
    expect(pinned.length).toBeGreaterThan(0);

    for (const props of pinned) {
      for (const edge of EDGES) {
        const value = props[edge];
        if (typeof value !== 'string' || SPANS_THE_WINDOW.test(value)) continue;
        // `--we-chrome-center-x` counts: it is the horizontal correction for a centred bar, which is
        // the same answer expressed for something that is not pinned to either side.
        expect(value, `a fixed node offsets '${edge}' by ${value} without clearing the content`).toContain(
          '--we-chrome-',
        );
      }
    }
  });
});

const ROOTS = ['app-shell', 'editor', 'design-system', 'templates', 'module-system'].map((pkg) =>
  join(__dirname, '..', '..', pkg),
);

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) found.push(path);
  }
  return found;
}

/** Comments describe the history — `editorDocks.ts` names the retired variable to explain a bug. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('the retired dock inset', () => {
  it('is read by nobody — chrome takes the composed answer, not the ingredients', () => {
    const offenders = ROOTS.flatMap((root) => sourceFiles(root)).filter((path) =>
      withoutComments(readFileSync(path, 'utf8')).includes('--we-dock-'),
    );

    expect(offenders).toEqual([]);
  });

  it('has a replacement that is actually published', () => {
    // The consumers above all pass a fallback of `0px`, so an unpublished variable is not an error
    // anywhere — every piece of chrome simply stops moving, quietly and permanently.
    const store = readFileSync(join(__dirname, '..', 'src', 'frameworks', 'solid', 'stores', 'ShellStore.tsx'), 'utf8');
    for (const name of ['left', 'right', 'top', 'bottom', 'center-x']) {
      expect(store).toContain(`'--we-chrome-${name}'`);
    }
  });
});
