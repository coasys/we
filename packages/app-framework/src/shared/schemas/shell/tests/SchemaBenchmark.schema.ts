/**
 * Schema Benchmark Template
 *
 * Performance benchmark suite for measuring schema renderer speed.
 * Each route stress-tests a different aspect of the rendering pipeline
 * and displays the measured render time.
 *
 * Routes:
 *   /                  — dashboard with results summary
 *   /static-small      — 50 static nodes (baseline)
 *   /static-large      — 200+ static nodes (scaling test)
 *   /static-extreme    — 1000 static nodes (scaling test)
 *   /tokens-light      — 50 nodes with 1-2 $store reads each
 *   /tokens-heavy      — 50 nodes with deeply composed tokens
 *   /each-flat         — $each with 100 items
 *   /each-nested       — nested $each (10 groups × 10 items)
 *   /web-components    — 100 web component nodes (we-text, we-button)
 *   /solid-components  — 100 Solid component nodes (Column, Row)
 *   /deep-nesting      — 30-level deep nesting
 *   /mixed-realistic   — ~70-node dashboard with representative token mix
 *   /update-perf       — 100 nodes bound to one $store value; measures the update path
 *   /idle              — near-empty bounce target the runner parks on between samples
 *
 * Timing: BenchmarkTimer sits at the end of each route and stamps four checkpoints, which
 * testStore turns into phase durations:
 *
 *   Build  navigation → timer constructed  — schema walk, token resolution, DOM construction
 *   Mount  timer constructed → onMount     — DOM insertion + custom-element upgrade
 *   Flush  onMount → microtask             — Lit's async first render and updated() hooks
 *   Paint  microtask → 2nd rAF             — style, layout, paint
 *
 * The Build boundary works precisely *because* the timer is the last child: its component body
 * cannot run until every preceding sibling has been built. An earlier version measured only from
 * that point onward, which excluded the entire schema walk from the result — the reason Tokens
 * Heavy used to score faster than Tokens Light despite doing strictly more token work.
 *
 * Sampling: every run takes 6 samples and reports the median of the last 5. The first is discarded
 * as warm-up — it is genuinely different for the first route of a session (Lit template
 * compilation, the class-level CSSStyleSheet), and discarding it is what makes a single route's
 * run comparable to a Run All run. It is not displayed: measured across five sessions its own
 * spread reached 32% on one route, so as a reported figure it was noise wearing the label of a
 * finding.
 *
 * Each result instead carries a `spread` — the trimmed range of the warm samples, dropping the
 * single slowest so one GC pause doesn't dominate — so every median comes with its own error bar.
 * A delta smaller than a route's spread means nothing. Measured spread runs from ~1% on the small
 * paint-bound routes to ~25% on Static Large, and varies that much run to run on the same route,
 * which is why it is judged against absolute bands rather than a per-route baseline (see
 * spreadColor). `heap` is the JS heap while parked on /idle just before the route rendered; a
 * figure that climbs down the results list indicates accumulation across routes rather than any
 * property of an individual route.
 *
 * Baselines: BASELINE_US_PER_ELEMENT below records each route's measured µs/element, and the colour
 * coding compares against it — green to +20%, amber to +50%, red beyond. It exists so the page
 * flags a *regression* rather than being permanently red, which is what both earlier threshold
 * schemes were.
 *
 * That is a source-recorded reference for colouring only, not a persisted runtime baseline. An
 * earlier version pinned results to localStorage and showed a percentage delta; it was removed
 * because verifying a change forces a reload, and cross-session drift (~10%, and up to ~14% after
 * a reboot) is far larger than within-session spread — so it reported drift as signal. Verifying a
 * change still means comparing two sets of results directly, from settled run 3s.
 */
import type { SchemaNode, TemplateSchema } from '@we/schema-shared';

/** Base path when mounted under the testing template */
export const benchmarkBasePath = '/benchmarks';

// ---------------------------------------------------------------------------
// Helpers — generate benchmark content programmatically
// ---------------------------------------------------------------------------

/** Timer placed at the end of each benchmark route.
 *  Stamps four checkpoints and hands them to testStore, which derives the phase durations. */
function timer(label: string): SchemaNode {
  return {
    type: 'BenchmarkTimer',
    props: {
      label,
      onComplete: { $action: 'testStore.benchRecordRender' },
    },
  };
}

/**
 * Recorded µs-per-element for each route, measured on a settled run 3 after the `setProperty`
 * write-tracking fix in @we/primitives. This is the reference the colour coding compares against.
 *
 * Per-route rather than one global number, because a single threshold cannot work here. Fixed
 * per-render overhead dominates small routes — Deep Nesting and Mixed Realistic sit at ~165µs/el
 * with ~140 elements, while Static Extreme manages 64µs/el across 8015 — so any global value either
 * paints the small routes permanently red or lets the large ones regress hugely without warning.
 * Two earlier attempts failed exactly that way: absolute-ms thresholds left Static Extreme always
 * red, and the first µs/el thresholds (40/80) left almost everything amber. A threshold that is
 * always red carries no information.
 *
 * These are machine-specific. If you run the suite on different hardware and everything reads red,
 * re-record rather than assuming a regression.
 */
const BASELINE_US_PER_ELEMENT: Record<string, number> = {
  'static-small': 75,
  'static-large': 64,
  'static-extreme': 64,
  'tokens-light': 83,
  'tokens-heavy': 103,
  'each-flat': 66,
  'each-nested': 66,
  'web-components': 89,
  'solid-components': 57,
  'deep-nesting': 165,
  'mixed-realistic': 167,
  'update-perf': 71,
};

/**
 * Colour a route's µs/element against its own recorded baseline.
 *
 * Bands are set from observed run-to-run variation, which reaches ~16% on the noisier routes
 * (Static Large, Nested $each) even between settled runs. Green therefore extends to +20% so normal
 * drift doesn't cry wolf; red starts at +50%, comfortably above noise and well below the kind of
 * regression worth catching — the shared-memo change measured +60–160% and would light up red.
 */
function benchColor(routeKey: string, shade: string): Record<string, unknown> {
  const path = `testStore.benchResults.${routeKey}.usPerElement`;
  const baseline = BASELINE_US_PER_ELEMENT[routeKey] ?? 0;
  return {
    $if: {
      condition: { $lt: [{ $store: path }, Math.round(baseline * 1.2)] },
      then: `success-${shade}`,
      else: {
        $if: {
          condition: { $lt: [{ $store: path }, Math.round(baseline * 1.5)] },
          then: `warning-${shade}`,
          else: `danger-${shade}`,
        },
      },
    },
  };
}

/** Same bands, but against `benchLastResult` — used on an individual route's own page. */
function benchLastColor(routeKey: string, shade: string): Record<string, unknown> {
  const path = 'testStore.benchLastResult.usPerElement';
  const baseline = BASELINE_US_PER_ELEMENT[routeKey] ?? 0;
  return {
    $if: {
      condition: { $lt: [{ $store: path }, Math.round(baseline * 1.2)] },
      then: `success-${shade}`,
      else: {
        $if: {
          condition: { $lt: [{ $store: path }, Math.round(baseline * 1.5)] },
          then: `warning-${shade}`,
          else: `danger-${shade}`,
        },
      },
    },
  };
}

/**
 * One phase row: label, duration, share of total.
 *
 * The share is emphasised rather than colour-coded. A phase taking 53% of the total isn't "bad" —
 * it's just where the time goes — so red/amber/green would be reading a judgment into a number that
 * doesn't carry one. Semantic colour is reserved for figures that do: µs/element and spread.
 */
function phaseRow(label: string, base: string, hint: string): SchemaNode {
  return {
    type: 'Row',
    props: { gap: '200', ay: 'center', width: '100%' },
    children: [
      { type: 'we-text', props: { fontSize: '200', color: 'neutral-500', width: '52px' }, children: [label] },
      {
        type: 'we-text',
        props: { fontSize: '200', fontWeight: '600', color: 'neutral-800', width: '64px', textAlign: 'right' },
        children: [{ $concat: [{ $store: `${base}.value` }, 'ms'] }],
      },
      {
        type: 'we-text',
        props: {
          fontSize: '200',
          fontWeight: '700',
          width: '44px',
          textAlign: 'right',
          // The dominant phase is the finding; the rest are context.
          color: {
            $if: {
              condition: { $gt: [{ $store: `${base}.share` }, 35] },
              then: 'primary-700',
              else: 'neutral-400',
            },
          },
        },
        children: [{ $concat: [{ $store: `${base}.share` }, '%'] }],
      },
      { type: 'we-text', props: { fontSize: '100', color: 'neutral-400' }, children: [hint] },
    ],
  };
}

/** Compact phase line for the dashboard cards — label, ms, share, one per line. */
function cardPhaseRow(label: string, key: string, routeKey: string): SchemaNode {
  const value = `testStore.benchResults.${routeKey}.phase.${key}.value`;
  const share = `testStore.benchResults.${routeKey}.phase.${key}.share`;
  return {
    type: 'Row',
    props: { gap: '200', ay: 'center', width: '100%' },
    children: [
      { type: 'we-text', props: { fontSize: '200', color: 'neutral-500', width: '44px' }, children: [label] },
      {
        type: 'we-text',
        props: { fontSize: '200', fontWeight: '600', color: 'neutral-700', width: '56px', textAlign: 'right' },
        children: [{ $concat: [{ $store: value }, 'ms'] }],
      },
      {
        type: 'we-text',
        props: {
          fontSize: '200',
          fontWeight: '700',
          width: '40px',
          textAlign: 'right',
          color: {
            $if: {
              condition: { $gt: [{ $store: share }, 35] },
              then: 'primary-700',
              else: 'neutral-400',
            },
          },
        },
        children: [{ $concat: [{ $store: share }, '%'] }],
      },
    ],
  };
}

/**
 * Spread answers "can I trust this run's median?", so unlike µs/element it is *not* compared to a
 * per-route baseline. Two reasons:
 *
 *  - The question is absolute, not relative. A route that habitually varies 25% would be painted
 *    green by a baseline while still meaning "don't trust this number".
 *  - Spread's own run-to-run variance exceeds the quantity itself — Static Large has measured
 *    7/12/15/19/24/26% across runs. Baselining that would encode whichever run happened to be
 *    recorded, which is a lottery rather than a reference.
 *
 * Bands are calibrated from measurement rather than guessed (the previous 4%/8% predated any data
 * and left most routes permanently amber, which carries no information). They are set by what a
 * given spread lets you *detect*: the µs/element danger band starts at +50%, so a spread up to ~20%
 * still leaves room to see a regression worth acting on. Beyond that the median is unreliable and
 * the run should be repeated.
 */
function spreadColor(routeKey: string): Record<string, unknown> {
  const path = `testStore.benchResults.${routeKey}.spreadPct`;
  return {
    $if: {
      condition: { $lt: [{ $store: path }, 10] },
      then: 'success-600',
      else: {
        $if: { condition: { $lt: [{ $store: path }, 20] }, then: 'warning-600', else: 'danger-600' },
      },
    },
  };
}

/** A static card with N text props — no tokens */
function staticCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: {
      p: '300',
      gap: '200',
      bg: 'neutral-0',
      r: '300',
      border: '1px solid neutral-200',
    },
    children: [
      { type: 'we-text', props: { text: `Card ${id}`, fontSize: '400', fontWeight: '600', color: 'neutral-800' } },
      { type: 'we-text', props: { text: `Description for card number ${id}`, fontSize: '300', color: 'neutral-600' } },
      { type: 'we-text', props: { text: `Detail line ${id}`, fontSize: '200', color: 'neutral-400' } },
    ],
  };
}

/** A card that reads from $store for its values */
function tokenCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: {
      p: '300',
      gap: '200',
      bg: 'neutral-0',
      r: '300',
    },
    children: [
      {
        type: 'we-text',
        props: {
          fontSize: '400',
          fontWeight: '600',
          color: 'neutral-800',
        },
        children: [{ $concat: ['Card ', { $store: 'testStore.stringValue' }, ` #${id}`] }],
      },
      {
        type: 'we-text',
        props: {
          fontSize: '300',
          color: {
            $if: {
              condition: { $store: 'testStore.boolTrue' },
              then: 'neutral-600',
              else: 'danger-600',
            },
          },
        },
        children: [{ $concat: ['Count: ', { $store: 'testStore.numberValue' }] }],
      },
    ],
  };
}

/** A card with deeply composed tokens — $if($and($eq($store,…), $not(…))) */
function heavyTokenCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: {
      p: '300',
      gap: '200',
      bg: {
        $if: {
          condition: {
            $and: [
              { $eq: [{ $store: 'testStore.stringValue' }, 'hello'] },
              { $not: { $store: 'testStore.boolFalse' } },
            ],
          },
          then: 'neutral-0',
          else: 'danger-50',
        },
      },
      r: '300',
    },
    children: [
      {
        type: 'we-text',
        props: {
          fontSize: '400',
          fontWeight: '600',
          color: {
            $if: {
              condition: {
                $or: [
                  { $eq: [{ $store: 'testStore.numberValue' }, 42] },
                  { $ne: [{ $store: 'testStore.stringValue' }, 'goodbye'] },
                ],
              },
              then: 'primary-700',
              else: 'danger-700',
            },
          },
        },
        children: [
          {
            $concat: [
              'Heavy #',
              `${id}`,
              ' — ',
              {
                $if: {
                  condition: { $store: 'testStore.boolTrue' },
                  then: { $store: 'testStore.stringValue' },
                  else: 'fallback',
                },
              },
            ],
          },
        ],
      },
      {
        type: 'we-text',
        props: {
          fontSize: '300',
          color: 'neutral-500',
        },
        children: [
          {
            $concat: [
              'Status: ',
              {
                $if: {
                  condition: { $and: [{ $store: 'testStore.boolTrue' }, { $not: { $store: 'testStore.boolFalse' } }] },
                  then: 'active',
                  else: 'inactive',
                },
              },
              ' | Count: ',
              { $store: 'testStore.numberValue' },
            ],
          },
        ],
      },
    ],
  };
}

/** Build N levels of nesting: Column → Row → Column → Row → ... */
function deepNest(depth: number, current: number = 0): SchemaNode {
  const isColumn = current % 2 === 0;
  const child: SchemaNode =
    current >= depth
      ? { type: 'we-text', props: { text: `Depth ${current}`, fontSize: '200', color: 'primary-600' } }
      : deepNest(depth, current + 1);

  return {
    type: isColumn ? 'Column' : 'Row',
    props: { p: '100', gap: '100', ...(current === 0 ? { bg: 'neutral-0', r: '300' } : {}) },
    children: [{ type: 'we-text', props: { text: `Level ${current}`, fontSize: '200', color: 'neutral-400' } }, child],
  };
}

/** A static web component card (we-text, we-button) */
function wcCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: { p: '200', gap: '200', bg: 'neutral-0', r: '200' },
    children: [
      { type: 'we-text', props: { text: `WC ${id}`, fontSize: '300', color: 'neutral-700' } },
      { type: 'we-button', props: { text: `Action ${id}`, variant: 'outline', size: 'sm' } },
    ],
  };
}

/** A static Solid component card (Column, Row — no web components) */
function solidCard(id: number): SchemaNode {
  return {
    type: 'Column',
    props: {
      p: '200',
      gap: '100',
      bg: 'neutral-0',
      r: '200',
      border: '1px solid neutral-100',
    },
    children: [
      {
        type: 'Row',
        props: { gap: '200', ay: 'center' },
        children: [
          { type: 'Column', props: { width: '8px', height: '8px', r: 'full', bg: 'primary-400' } },
          {
            type: 'Column',
            children: [{ type: 'we-text', props: { text: `Solid ${id}`, fontSize: '300', color: 'neutral-700' } }],
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Generate route content
// ---------------------------------------------------------------------------

function generateCards(count: number, factory: (id: number) => SchemaNode): SchemaNode[] {
  return Array.from({ length: count }, (_, i) => factory(i + 1));
}

/** Build a full benchmark route: Column wrapper + back button + timer + content */
function benchRoute(path: string, title: string, children: SchemaNode[]) {
  // '/static-small' -> 'static-small', matching the keys in BASELINE_US_PER_ELEMENT.
  const routeKey = path.slice(1);
  return {
    path,
    type: 'Column',
    props: { width: '100%', height: '100%', gap: '300', bg: 'neutral-50', overflow: 'auto' },
    children: [
      {
        type: 'Row',
        props: { gap: '300', ay: 'center', pb: '300' },
        children: [
          {
            type: 'we-button',
            props: {
              variant: 'ghost',
              size: 'sm',
              onClick: { $action: 'routeStore.navigate', args: [benchmarkBasePath] },
            },
            children: [{ type: 'we-icon', props: { name: 'arrow-left', size: 'sm' } }],
          },
          { type: 'we-text', props: { text: title, fontSize: '600', fontWeight: '600', color: 'neutral-800' } },
        ],
      },
      // No sampling-status indicator here on purpose. It previously used we-spinner, which
      // animates — continuous compositor work inside the measured window, on every one of the 72
      // renders a Run All performs. Progress now lives in the run overlay instead, which is static.
      //
      // Last completed result for this route — full phase breakdown.
      {
        type: '$if',
        props: {
          condition: { $store: 'testStore.benchLastResult.median' },
          then: {
            type: 'Column',
            props: {
              gap: '100',
              p: '300',
              bg: benchLastColor(routeKey, '50'),
              r: '300',
              mb: '300',
            },
            children: [
              {
                type: 'Row',
                props: { gap: '200', ay: 'center', pb: '100' },
                children: [
                  {
                    type: 'we-icon',
                    props: { name: 'clock', color: benchLastColor(routeKey, '600') },
                  },
                  {
                    type: 'we-text',
                    props: {
                      fontWeight: '700',
                      color: benchLastColor(routeKey, '700'),
                    },
                    children: [{ $concat: [{ $store: 'testStore.benchLastResult.median.total' }, 'ms total'] }],
                  },
                  {
                    type: 'we-text',
                    props: { fontSize: '200', color: 'neutral-500' },
                    children: [
                      {
                        $concat: [
                          'median of ',
                          { $store: 'testStore.benchLastResult.sampleCount' },
                          ' · ',
                          { $store: 'testStore.benchLastResult.usPerElement' },
                          'µs/element · ',
                          { $store: 'testStore.benchLastResult.usPerCustomElement' },
                          'µs/custom element',
                        ],
                      },
                    ],
                  },
                ],
              },
              phaseRow('Build', 'testStore.benchLastResult.phase.build', 'schema walk + token resolution'),
              phaseRow('Mount', 'testStore.benchLastResult.phase.mount', 'insertion + custom-element upgrade'),
              phaseRow('Flush', 'testStore.benchLastResult.phase.flush', 'Lit first render + updated()'),
              phaseRow('Paint', 'testStore.benchLastResult.phase.paint', 'style, layout, paint'),
              {
                type: 'Row',
                props: { gap: '200', ay: 'center', pt: '100' },
                children: [
                  {
                    type: 'we-text',
                    props: { fontSize: '100', color: 'neutral-400' },
                    children: [
                      {
                        $concat: [
                          { $store: 'testStore.benchLastResult.median.elements' },
                          ' elements · ',
                          { $store: 'testStore.benchLastResult.median.customElements' },
                          ' custom · spread ',
                          { $store: 'testStore.benchLastResult.spreadLow' },
                          '–',
                          { $store: 'testStore.benchLastResult.spreadHigh' },
                          'ms · heap ',
                          { $store: 'testStore.benchLastResult.heapMb' },
                          'mb',
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      },
      ...children,
      timer(path.slice(1)),
    ],
  };
}

// ---------------------------------------------------------------------------
// Route: Static Small (50 cards)
// ---------------------------------------------------------------------------
const staticSmallRoute = benchRoute('/static-small', 'Static Small — 50 nodes', [
  {
    type: 'we-text',
    props: { text: '50 static cards, all string props, zero tokens', fontSize: '300', color: 'neutral-500' },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' },
    },
    children: generateCards(50, staticCard),
  },
]);

// ---------------------------------------------------------------------------
// Route: Static Large (200 cards)
// ---------------------------------------------------------------------------
const staticLargeRoute = benchRoute('/static-large', 'Static Large — 200 nodes', [
  {
    type: 'we-text',
    props: {
      text: '200 static cards — tests scaling of static prop overhead',
      fontSize: '300',
      color: 'neutral-500',
    },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' },
    },
    children: generateCards(200, staticCard),
  },
]);

// ---------------------------------------------------------------------------
// Route: Static Extreme (1000 cards)
// ---------------------------------------------------------------------------
const staticExtremeRoute = benchRoute('/static-extreme', 'Static Extreme — 1000 nodes', [
  {
    type: 'we-text',
    props: {
      text: '1000 static cards — tests scaling of static prop overhead',
      fontSize: '300',
      color: 'neutral-500',
    },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(180px, 1fr))', gap: '8px' },
    },
    children: generateCards(1000, staticCard),
  },
]);

// ---------------------------------------------------------------------------
// Route: Tokens Light (50 cards with $store reads)
// ---------------------------------------------------------------------------
const tokensLightRoute = benchRoute('/tokens-light', 'Tokens Light — $store reads', [
  {
    type: 'we-text',
    props: { text: '50 cards each with 1-2 $store and $concat tokens', fontSize: '300', color: 'neutral-500' },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' },
    },
    children: generateCards(50, tokenCard),
  },
]);

// ---------------------------------------------------------------------------
// Route: Tokens Heavy (50 cards with deeply composed tokens)
// ---------------------------------------------------------------------------
const tokensHeavyRoute = benchRoute('/tokens-heavy', 'Tokens Heavy — deep composition', [
  {
    type: 'we-text',
    props: {
      text: '50 cards each with $if($and($eq($store,…), $not(…))) chains',
      fontSize: '300',
      color: 'neutral-500',
    },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' },
    },
    children: generateCards(50, heavyTokenCard),
  },
]);

// ---------------------------------------------------------------------------
// Route: $each Flat (100 items)
// ---------------------------------------------------------------------------
const eachFlatRoute = benchRoute('/each-flat', '$each Flat — 100 items', [
  {
    type: 'we-text',
    props: { text: 'Single $each loop rendering 100 simple cards', fontSize: '300', color: 'neutral-500' },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' },
    },
    children: [
      {
        type: '$each',
        props: { items: { $store: 'testStore.benchList100' } },
        children: [
          {
            type: 'Column',
            props: { p: '300', gap: '100', bg: 'neutral-0', r: '300' },
            children: [
              { type: 'we-text', props: { color: 'neutral-700' }, children: ['$item.name'] },
              { type: 'we-text', props: { fontSize: '200', color: 'neutral-400' }, children: ['$item.category'] },
            ],
          },
        ],
      },
    ],
  },
]);

// ---------------------------------------------------------------------------
// Route: $each Nested (10 groups × 10 items)
// ---------------------------------------------------------------------------
const eachNestedRoute = benchRoute('/each-nested', 'Nested $each — 10×10', [
  {
    type: 'we-text',
    props: { text: '10 groups with 10 items each — tests context spreading', fontSize: '300', color: 'neutral-500' },
  },
  {
    type: 'Column',
    props: { gap: '300' },
    children: [
      {
        type: '$each',
        props: { items: { $store: 'testStore.benchGroups' }, as: 'group' },
        children: [
          {
            type: 'Column',
            props: { p: '300', gap: '200', bg: 'neutral-0', r: '300' },
            children: [
              {
                type: 'we-text',
                props: { fontWeight: '600', color: 'neutral-700', fontSize: '400' },
                children: ['$group.name'],
              },
              {
                type: '$each',
                props: { items: '$group.items', as: 'sub' },
                children: [
                  {
                    type: 'Row',
                    props: { gap: '200', pl: '300', ay: 'center' },
                    children: [
                      { type: 'we-text', props: { color: 'neutral-400' }, children: ['•'] },
                      { type: 'we-text', props: { fontSize: '300' }, children: ['$sub.label'] },
                      {
                        type: 'we-text',
                        props: { fontSize: '200', color: 'neutral-400' },
                        children: ['$sub.detail'],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
]);

// ---------------------------------------------------------------------------
// Route: Web Components (100 we-text + we-button)
// ---------------------------------------------------------------------------
const wcRoute = benchRoute('/web-components', 'Web Components — 100 nodes', [
  {
    type: 'we-text',
    props: {
      text: '100 we-text + we-button pairs — isolates per-prop createEffect overhead',
      fontSize: '300',
      color: 'neutral-500',
    },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' },
    },
    children: generateCards(100, wcCard),
  },
]);

// ---------------------------------------------------------------------------
// Route: Solid Components (100 Column + Row)
// ---------------------------------------------------------------------------
const solidRoute = benchRoute('/solid-components', 'Solid Components — 100 nodes', [
  {
    type: 'we-text',
    props: {
      text: '100 Column + Row nodes — same layout, reactive spread path',
      fontSize: '300',
      color: 'neutral-500',
    },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' },
    },
    children: generateCards(100, solidCard),
  },
]);

// ---------------------------------------------------------------------------
// Route: Deep Nesting (30 levels)
// ---------------------------------------------------------------------------
const deepNestRoute = benchRoute('/deep-nesting', 'Deep Nesting — 30 levels', [
  {
    type: 'we-text',
    props: { text: 'Column → Row → Column chain, 30 levels deep', fontSize: '300', color: 'neutral-500' },
  },
  deepNest(30),
]);

// ---------------------------------------------------------------------------
// Route: Mixed Realistic (~70 nodes, representative token mix)
// ---------------------------------------------------------------------------
const mixedRealisticRoute = benchRoute('/mixed-realistic', 'Mixed Realistic — ~70 nodes', [
  {
    type: 'we-text',
    props: { text: 'Dashboard-like layout with representative token mix', fontSize: '300', color: 'neutral-500' },
  },
  // Welcome header with $store
  {
    type: 'Column',
    props: { width: '100%', p: '400', gap: '200', bg: 'neutral-0', r: '400' },
    children: [
      {
        type: 'we-text',
        props: { fontSize: '700', fontWeight: '600', color: 'neutral-900' },
        children: [{ $concat: ['Welcome, ', { $store: 'testStore.stringValue' }] }],
      },
      {
        type: 'we-text',
        props: { fontSize: '400', color: 'neutral-600' },
        children: [{ $concat: ['Counter: ', { $store: 'testStore.counter' }] }],
      },
    ],
  },
  // Stat cards — 4 static cards
  {
    type: 'Row',
    props: { width: '100%', gap: '300', wrap: true },
    children: [
      ...[
        { label: 'Active Spaces', value: '12', change: '+2 this week', color: 'primary-500' },
        { label: 'Messages', value: '24', change: '5 unread', color: 'blue-500' },
        { label: 'Quests', value: '7', change: '3 due', color: 'green-500' },
        { label: 'Notifications', value: '18', change: 'New today', color: 'orange-500' },
      ].map((stat) => ({
        type: 'Column',
        props: {
          flex: '1',
          minWidth: '160px',
          p: '400',
          gap: '200',
          bg: 'neutral-0',
          r: '400',
          borderLeft: `4px solid ${stat.color}`,
        },
        children: [
          { type: 'we-text', props: { text: stat.label, fontSize: '300', color: 'neutral-600' } },
          { type: 'we-text', props: { text: stat.value, fontSize: '800', fontWeight: '700', color: 'neutral-900' } },
          { type: 'we-text', props: { text: stat.change, fontSize: '300', color: stat.color } },
        ],
      })),
    ],
  },
  // Two column layout
  {
    type: 'Row',
    props: { width: '100%', gap: '400', ax: 'start' },
    children: [
      // Left — activity list with $each
      {
        type: 'Column',
        props: { flex: '2', gap: '300' },
        children: [
          {
            type: 'we-text',
            props: { text: 'Recent Activity', fontWeight: '600', color: 'neutral-800' },
          },
          {
            type: 'Column',
            props: { gap: '200' },
            children: [
              {
                type: '$each',
                props: { items: { $store: 'testStore.fruits' } },
                children: [
                  {
                    type: 'Row',
                    props: { p: '300', gap: '300', bg: 'neutral-0', r: '300', ay: 'center' },
                    children: [
                      { type: 'we-text', children: ['$item.emoji'] },
                      {
                        type: 'Column',
                        props: { flex: '1', gap: '100' },
                        children: [
                          {
                            type: 'we-text',
                            props: { color: 'neutral-800' },
                            children: ['$item.name'],
                          },
                          {
                            type: 'we-text',
                            props: { fontSize: '200', color: 'neutral-500' },
                            children: ['$item.color'],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      // Right — quick actions + conditional content
      {
        type: 'Column',
        props: { flex: '1', gap: '300' },
        children: [
          {
            type: 'we-text',
            props: { text: 'Quick Actions', fontWeight: '600', color: 'neutral-800' },
          },
          {
            type: 'Column',
            props: { gap: '200' },
            children: [
              {
                type: 'we-button',
                props: {
                  text: 'Toggle State',
                  variant: 'primary',
                  width: '100%',
                  onClick: { $action: 'testStore.toggle' },
                },
              },
              {
                type: 'we-button',
                props: {
                  text: 'Increment Counter',
                  variant: 'secondary',
                  width: '100%',
                  onClick: { $action: 'testStore.increment' },
                },
              },
              { type: 'we-button', props: { text: 'Action Three', variant: 'outline', width: '100%' } },
              { type: 'we-button', props: { text: 'Action Four', variant: 'ghost', width: '100%' } },
            ],
          },
          // Conditional section
          {
            type: '$if',
            props: {
              condition: { $store: 'testStore.toggleValue' },
              then: {
                type: 'Column',
                props: { p: '300', gap: '200', bg: 'success-50', r: '300' },
                children: [
                  { type: 'we-text', props: { fontWeight: '600', color: 'success-700' }, children: ['Toggle is ON'] },
                  {
                    type: 'we-text',
                    props: { fontSize: '300', color: 'success-600' },
                    children: ['This section appears conditionally'],
                  },
                ],
              },
              else: {
                type: 'Column',
                props: { p: '300', gap: '200', bg: 'neutral-100', r: '300' },
                children: [
                  {
                    type: 'we-text',
                    props: { fontWeight: '600', color: 'neutral-600' },
                    children: ['Toggle is OFF'],
                  },
                  {
                    type: 'we-text',
                    props: { fontSize: '300', color: 'neutral-500' },
                    children: ['Toggle the state to show content'],
                  },
                ],
              },
            },
          },
          // Events list — static
          {
            type: 'Column',
            props: { gap: '300', pt: '200' },
            children: [
              {
                type: 'we-text',
                props: { text: 'Upcoming', fontWeight: '600', color: 'neutral-800' },
              },
              ...['Team Standup — 10:00 AM', 'Design Review — 2:00 PM', 'Sprint Planning — Friday'].map((event) => ({
                type: 'Column',
                props: { p: '300', bg: 'neutral-0', r: '300' },
                children: [{ type: 'we-text', props: { text: event, fontSize: '300', color: 'neutral-700' } }],
              })),
            ],
          },
        ],
      },
    ],
  },
]);

// ---------------------------------------------------------------------------
// Route: Reactive Update (100 nodes bound to one $store value)
// ---------------------------------------------------------------------------
const updatePerfRoute = benchRoute('/update-perf', 'Reactive Update — 100 bound nodes', [
  {
    type: 'we-text',
    props: {
      text: '100 nodes bound to a single $store value — measures the update path, not mount',
      fontSize: '300',
      color: 'neutral-500',
    },
  },
  {
    type: 'Column',
    props: {
      gap: '200',
      styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(150px, 1fr))', gap: '6px' },
    },
    children: generateCards(100, (id) => ({
      type: 'Column',
      props: { p: '200', gap: '100', bg: 'neutral-0', r: '200' },
      children: [
        { type: 'we-text', props: { fontSize: '200', color: 'neutral-500' }, children: [`Cell ${id}`] },
        {
          type: 'we-text',
          props: { fontWeight: '600', color: 'primary-700' },
          children: [{ $concat: ['#', { $store: 'testStore.counter' }] }],
        },
      ],
    })),
  },
]);

// ---------------------------------------------------------------------------
// Route: Idle — the bounce target between repeat samples
//
// Median-of-N needs the same route rendered several times, but navigating to the path you are
// already on is a no-op — no remount, nothing to measure. The runner therefore bounces through
// here between samples. Kept deliberately near-empty so the previous route's teardown lands on a
// cheap page, outside the next measurement window.
// ---------------------------------------------------------------------------
const idleRoute = {
  path: '/idle',
  type: 'Column',
  props: { width: '100%', height: '100%', p: '400', bg: 'neutral-50' },
  children: [
    {
      type: 'we-text',
      props: { color: 'neutral-400', fontSize: '200' },
      children: ['Settling between samples…'],
    },
  ],
};

// ---------------------------------------------------------------------------
// Dashboard route — results summary + navigation
//
// Exported so testStore's runner builds its queue from exactly this list — a route can't be added
// to the dashboard and silently skipped by Run All.
// ---------------------------------------------------------------------------
export const benchmarkRoutes: {
  path: string;
  key: string;
  label: string;
  nav: string;
  measuresUpdate?: boolean;
}[] = [
  { path: '/static-small', key: 'static-small', label: 'Static Small (50)', nav: `${benchmarkBasePath}/static-small` },
  { path: '/static-large', key: 'static-large', label: 'Static Large (200)', nav: `${benchmarkBasePath}/static-large` },
  {
    path: '/static-extreme',
    key: 'static-extreme',
    label: 'Static Extreme (1000)',
    nav: `${benchmarkBasePath}/static-extreme`,
  },
  { path: '/tokens-light', key: 'tokens-light', label: 'Tokens Light', nav: `${benchmarkBasePath}/tokens-light` },
  { path: '/tokens-heavy', key: 'tokens-heavy', label: 'Tokens Heavy', nav: `${benchmarkBasePath}/tokens-heavy` },
  { path: '/each-flat', key: 'each-flat', label: '$each Flat (100)', nav: `${benchmarkBasePath}/each-flat` },
  { path: '/each-nested', key: 'each-nested', label: 'Nested $each (10×10)', nav: `${benchmarkBasePath}/each-nested` },
  {
    path: '/web-components',
    key: 'web-components',
    label: 'Web Components (100)',
    nav: `${benchmarkBasePath}/web-components`,
  },
  {
    path: '/solid-components',
    key: 'solid-components',
    label: 'Solid Components (100)',
    nav: `${benchmarkBasePath}/solid-components`,
  },
  { path: '/deep-nesting', key: 'deep-nesting', label: 'Deep Nesting (30)', nav: `${benchmarkBasePath}/deep-nesting` },
  {
    path: '/mixed-realistic',
    key: 'mixed-realistic',
    label: 'Mixed Realistic',
    nav: `${benchmarkBasePath}/mixed-realistic`,
  },
  {
    path: '/update-perf',
    key: 'update-perf',
    label: 'Reactive Update (100)',
    nav: `${benchmarkBasePath}/update-perf`,
    measuresUpdate: true,
  },
];

/**
 * Persistent header — lives on the template root, above the route outlet, so the title and controls
 * stay visible while the runner navigates between routes. Previously this sat inside the dashboard
 * route, which meant it vanished the moment a run started and took the Run All button with it.
 */
const benchHeader: SchemaNode = {
  type: 'Column',
  props: { gap: '300', mb: '400', bg: 'neutral-50' },
  children: [
    {
      type: 'we-text',
      props: { fontSize: '700', fontWeight: '700', color: 'primary-800' },
      children: ['Renderer Benchmarks'],
    },
    {
      type: 'we-text',
      props: { color: 'neutral-600' },
      children: [
        'Each run takes 6 samples (first discarded as warm-up) and reports the median, split by phase. ' +
          'The headline µs/element figure is coloured against each route’s own recorded baseline — ' +
          'green within +20%, amber to +50%, red beyond — so colour means regression, not size. ' +
          'Reboot before measuring a change, then compare settled run 3s.',
      ],
    },
    {
      type: 'Row',
      props: { gap: '200', py: '200', wrap: true },
      children: [
        {
          type: 'we-button',
          props: {
            text: 'Run All',
            variant: 'primary',
            gradient: true,
            loading: { $store: 'testStore.benchRunning' },
            disabled: { $store: 'testStore.benchRunning' },
            onClick: { $action: 'testStore.benchRunAll' },
          },
        },
        {
          type: 'we-button',
          props: {
            text: 'Clear All Results',
            variant: 'secondary',
            disabled: { $store: 'testStore.benchRunning' },
            onClick: { $action: 'testStore.benchClearResults' },
          },
        },
      ],
    },
    { type: 'we-divider' },
  ],
};

const dashboardRoute = {
  path: '/',
  type: 'Column',
  props: { width: '100%', height: '100%', gap: '400', bg: 'neutral-50', overflow: 'auto' },
  children: [
    // Benchmark navigation grid
    {
      type: 'Column',
      props: {
        gap: '200',
        styles: { display: 'grid', 'grid-template-columns': 'repeat(auto-fill, minmax(250px, 1fr))', gap: '12px' },
      },
      children: benchmarkRoutes.map((route) => ({
        type: 'Column',
        props: {
          p: '400',
          gap: '200',
          bg: 'neutral-0',
          r: '400',
          cursor: 'pointer',
          border: '1px solid neutral-200',
          hoverProps: { bg: 'primary-25', borderColor: 'primary-300' },
          // Both the card and the Run button go through benchRun rather than navigating directly.
          // A bare navigate would render the route without a sampling session, so the timer would
          // have no navigation timestamp to measure Build against and the result would be dropped.
          onClick: { $action: 'testStore.benchRun', args: [route.key] },
        },
        children: [
          {
            type: 'Row',
            props: { gap: '200', ay: 'center', ax: 'between', width: '100%' },
            children: [
              { type: 'we-text', props: { text: route.label, fontWeight: '600', color: 'neutral-800' } },
              {
                type: 'we-button',
                props: {
                  text: 'Run',
                  variant: 'primary',
                  size: 'sm',
                  onClick: { $action: 'testStore.benchRun', args: [route.key] },
                },
              },
            ],
          },
          { type: 'we-text', props: { text: route.path, fontSize: '300', color: 'neutral-400' } },
          // Last result for this route — headline is the normalised per-element figure, since
          // total ms alone can't be compared between a 70-node and a 4000-node route.
          {
            type: '$if',
            props: {
              condition: { $store: `testStore.benchResults.${route.key}.median` },
              then: {
                type: 'Column',
                props: { gap: '100', pt: '100' },
                children: [
                  {
                    type: 'Row',
                    props: { gap: '200', ay: 'center' },
                    children: [
                      {
                        type: 'we-text',
                        props: {
                          fontSize: '400',
                          fontWeight: '700',
                          color: benchColor(route.key, '600'),
                        },
                        children: [
                          { $concat: [{ $store: `testStore.benchResults.${route.key}.usPerElement` }, 'µs/el'] },
                        ],
                      },
                      {
                        type: 'we-text',
                        props: { fontSize: '300', color: 'neutral-500' },
                        children: [
                          { $concat: [{ $store: `testStore.benchResults.${route.key}.median.total` }, 'ms total'] },
                        ],
                      },
                    ],
                  },
                  // Phases, one per line — the previous single dot-separated run-on was unreadable
                  // and made it impossible to see at a glance which phase dominates.
                  {
                    type: 'Column',
                    props: { gap: '0', pt: '100', pb: '100' },
                    children: [
                      cardPhaseRow('build', 'build', route.key),
                      cardPhaseRow('mount', 'mount', route.key),
                      cardPhaseRow('flush', 'flush', route.key),
                      cardPhaseRow('paint', 'paint', route.key),
                    ],
                  },
                  {
                    type: 'we-text',
                    props: { fontSize: '100', color: 'neutral-400' },
                    children: [
                      {
                        $concat: [
                          { $store: `testStore.benchResults.${route.key}.median.elements` },
                          ' el · ',
                          { $store: `testStore.benchResults.${route.key}.median.customElements` },
                          ' custom · heap ',
                          { $store: `testStore.benchResults.${route.key}.heapMb` },
                          'mb',
                        ],
                      },
                    ],
                  },
                  {
                    type: 'we-text',
                    props: { fontSize: '100', fontWeight: '600', color: spreadColor(route.key) },
                    children: [
                      {
                        $concat: [
                          'spread ',
                          { $store: `testStore.benchResults.${route.key}.spreadLow` },
                          '–',
                          { $store: `testStore.benchResults.${route.key}.spreadHigh` },
                          'ms (',
                          { $store: `testStore.benchResults.${route.key}.spreadPct` },
                          '%)',
                        ],
                      },
                    ],
                  },
                  // Only the update-measuring route populates this.
                  {
                    type: '$if',
                    props: {
                      condition: { $store: `testStore.benchResults.${route.key}.updateMs` },
                      then: {
                        type: 'we-text',
                        props: { fontSize: '200', fontWeight: '600', color: 'primary-600' },
                        children: [
                          {
                            $concat: ['update ', { $store: `testStore.benchResults.${route.key}.updateMs` }, 'ms'],
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      })),
    },
  ],
};

// ---------------------------------------------------------------------------
// Full template export
// ---------------------------------------------------------------------------
/**
 * Full-viewport cover shown while the runner is sampling.
 *
 * A Run All is 12 routes × 6 samples = 72 renders, each bouncing through /idle — 144 navigations
 * of visible thrash. This hides that behind a stable progress panel.
 *
 * Two constraints make this safe to measure through, and both are load-bearing:
 *
 * 1. It **covers**, it does not hide. `display: none` would skip layout and paint entirely and
 *    `visibility: hidden` would skip paint — either would collapse the Paint phase to nothing and
 *    silently invalidate every number the suite produces. The route underneath stays in normal
 *    flow, laid out and painted; this simply sits on top of it.
 * 2. The progress bar is **determinate and static** — no spinner, no CSS animation. An animating
 *    element would add continuous compositor work inside the measured window on all 72 samples.
 *
 * The overlay is mounted during the /idle baseline capture as well as at paint, so its own
 * elements cancel out of the element-count delta rather than inflating it.
 *
 * Residual risk: a browser may skip painting fully-occluded content. If Paint drops noticeably
 * versus the pre-overlay runs, that's occlusion culling and this needs to come back out.
 *
 * Scoped with `position: absolute` inside the route-outlet wrapper rather than `fixed` to the
 * viewport, so the persistent header — and the app shell around it — stay visible and usable while
 * a run is in progress. Only the thrashing part is covered.
 *
 * `position: fixed`, sized by the viewport. That is the load-bearing decision and it is about
 * measurement, not aesthetics: a fixed element is out of flow entirely, so it cannot change the
 * layout — and therefore cannot change what the browser paints — for the route being measured.
 * Every in-flow alternative can.
 *
 * Three earlier attempts failed, all for the same underlying reason: they sized the overlay against
 * the route-outlet wrapper, whose height swings between a near-empty /idle and a full route on
 * every one of the 144 navigations a Run All performs.
 *   - `height: 100%` + vertical centring → panel jumps between samples (the wrapper's height varies).
 *   - `height: 100%` + `minHeight: 100vh` + a 100vh sticky child → stable, but a full extra screen
 *     tall with dead space to scroll through.
 *   - Top-anchoring → stable, but cannot be centred.
 * Sizing against the viewport removes the dependency rather than compensating for it.
 *
 * `top` is a hardcoded pixel offset, which is the one genuinely unsatisfying part. CSS cannot say
 * "start where the header ends" for a fixed element — it can only reference the viewport — so
 * covering exactly the cards region while staying viewport-stable requires knowing that distance
 * up front. BENCH_OVERLAY_TOP is that measurement: the shell nav plus the benchmark header. If the
 * overlay ever starts too low (route content visible above it) or too high (clipping the header),
 * this is the number to adjust, and nothing else needs to change.
 *
 * Note also that `ax`/`ay` are literal x/y axes, not main/cross — see mapFlexAxes in
 * @we/design-utils, where a column maps ay -> justify-content and ax -> align-items.
 */
const BENCH_OVERLAY_TOP = '380px';

const runOverlay: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'testStore.benchStatus' },
    then: {
      type: 'Column',
      props: {
        position: 'fixed',
        // top + bottom rather than a height: the box then spans from below the header to the
        // bottom of the viewport, so it is exactly the remaining screen space with nothing to
        // scroll past — and its size still never depends on the route rendering behind it.
        top: BENCH_OVERLAY_TOP,
        bottom: '0',
        left: '0',
        right: '0',
        zIndex: 'modal',
        bg: 'neutral-50',
        ax: 'center',
        ay: 'center',
        px: '500',
        overflow: 'hidden',
      },
      children: [
        {
          type: 'Column',
          props: { gap: '300', width: '100%', maxWidth: '420px', ax: 'center' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '600', fontWeight: '700', color: 'primary-800' },
              children: ['Running benchmarks'],
            },
            {
              type: 'we-text',
              props: { fontSize: '300', color: 'neutral-500' },
              children: [{ $store: 'testStore.benchRouteProgress' }],
            },
            {
              type: 'we-progress-bar',
              props: { value: { $store: 'testStore.benchProgress' }, max: 100, width: '100%' },
            },
            {
              type: 'we-text',
              props: { fontSize: '300', fontWeight: '600', color: 'neutral-700' },
              children: [{ $store: 'testStore.benchStatus' }],
            },
            {
              type: 'we-text',
              props: { fontSize: '200', color: 'neutral-400', textAlign: 'center' },
              children: ['Each route renders 6 times; the first is discarded as warm-up.'],
            },
          ],
        },
      ],
    },
  },
};

export const schemaBenchmarkTemplate: TemplateSchema = {
  meta: {
    name: 'Schema Benchmark',
    description: 'Performance benchmark suite for schema renderer',
    icon: 'timer',
    stores: ['testStore'],
    components: ['BenchmarkTimer'],
  },
  type: 'Column',
  props: { width: '100%', height: '100%', bg: 'neutral-50' },
  children: [
    benchHeader,
    // Route outlet. Deliberately carries no height, flex or overflow constraints: this box wraps
    // the content being measured, and constraining it would change that content's layout — and so
    // what the browser paints — invalidating comparison against every run recorded so far. The run
    // overlay is `position: fixed` precisely so it needs nothing from this element.
    {
      type: 'Column',
      props: { width: '100%' },
      children: [{ type: '$routes' }, runOverlay],
    },
  ],
  routes: [
    dashboardRoute,
    staticSmallRoute,
    staticLargeRoute,
    staticExtremeRoute,
    tokensLightRoute,
    tokensHeavyRoute,
    eachFlatRoute,
    eachNestedRoute,
    wcRoute,
    solidRoute,
    deepNestRoute,
    mixedRealisticRoute,
    updatePerfRoute,
    idleRoute,
    {
      path: '*',
      type: 'Column',
      props: { p: '500' },
      children: [{ type: 'we-text', props: { text: 'Benchmark route not found' } }],
    },
  ],
};
