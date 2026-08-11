/**
 * The page: columns that differ in exactly one thing each, so seeing the flicker locates it.
 *
 * The graph explorer could never answer "is this the design system or is this the app" because it
 * only ever ran one of them. Every row here is the same list of buttons at the same size in the same
 * layout; what changes between rows is which layer is involved. Wherever the flicker appears, the
 * layers absent from that row are eliminated — including, if it shows on the plain-DOM control, all
 * of WE.
 *
 * There is deliberately no framework on this page. If the flicker reproduces here, Solid's rendering
 * is not part of it; if it does not reproduce here but does in the explorer, Solid or the explorer's
 * own chrome is exactly where to look next. That single bit of information is the reason this exists
 * as a separate app rather than another panel in the explorer.
 */
import '@we/primitives';
import '@we/tokens/css';
import '@we/themes';
import './styles.css';

import { applyThemeVars } from '@we/schema-shared';
import { THEME_PRESETS, type ThemeName } from '@we/themes/presets';

import { type Anomaly, type Probe, startProbe, type Surface } from './probe';

/** The explorer's scenario rail, near enough — same labels, same length, same vertical stack. */
const LABELS = [
  'Knowledge map',
  'Schema map',
  'Board (manual)',
  'Paging a hub',
  'Cluster map',
  'Static diagram',
  'Budget guard',
  'Property drill-down',
  'Content tree',
  'Reverse traversal',
];

interface Row {
  id: string;
  title: string;
  /**
   * Whether this column is the thing being fixed or a specimen to compare it against.
   *
   * Only the `we-button` columns are WE. The plain-<button> columns are hand-written CSS in this
   * app's own stylesheet, so a design-system change cannot alter them and they are *expected* to go
   * on flickering — that is what makes them useful. Saying so on the page removes the obvious
   * misreading, which has already happened once: a fix landed, most of the page still flickered, and
   * it looked like the fix had failed.
   */
  underTest?: boolean;
  /** What this row is here to rule in or out. */
  isolates: string;
  build: (label: string) => HTMLElement;
  /** Where the colour actually lands — inside the shadow root for a primitive. */
  painted: (host: HTMLElement) => Element | null;
}

const ROWS: Row[] = [
  {
    id: 'ghost',
    underTest: true,
    title: 'we-button · ghost',
    isolates: 'The explorer’s scenario buttons exactly. Lit, shadow DOM, DS state rules, the lot.',
    build: (label) => {
      const el = document.createElement('we-button');
      el.setAttribute('variant', 'ghost');
      el.setAttribute('size', 'sm');
      el.textContent = label;
      return el;
    },
    painted: (host) => host.shadowRoot?.querySelector('[part="base"]') ?? null,
  },
  {
    id: 'hoverprops',
    underTest: true,
    title: 'we-button · ghost + explicit hoverProps',
    isolates: 'The same, but with the hover colour set as a DS prop rather than inherited from the variant.',
    build: (label) => {
      const el = document.createElement('we-button');
      el.setAttribute('variant', 'ghost');
      el.setAttribute('size', 'sm');
      el.textContent = label;
      (el as unknown as { hoverProps: Record<string, string> }).hoverProps = { bg: 'primary-100' };
      return el;
    },
    painted: (host) => host.shadowRoot?.querySelector('[part="base"]') ?? null,
  },
  {
    id: 'ghostbg',
    underTest: true,
    title: 'we-button · ghost, hover changes background only',
    isolates:
      'Ghost’s own hover colour, but without the text-colour change that comes with it. Column 1 animates background *and* color, because that is what the ghost variant declares; the hoverProps column happens to animate background alone, and is the one that went quiet. This holds the colour identical to column 1 and removes only the text change.',
    build: (label) => {
      const el = document.createElement('we-button');
      el.setAttribute('variant', 'ghost');
      el.setAttribute('size', 'sm');
      el.textContent = label;
      (el as unknown as { hoverProps: Record<string, string> }).hoverProps = { bg: 'neutral-100' };
      return el;
    },
    painted: (host) => host.shadowRoot?.querySelector('[part="base"]') ?? null,
  },
  {
    id: 'ghostboth',
    underTest: true,
    title: 'we-button · ghost, hover changes background and text',
    isolates:
      'The ghost variant’s defaults, written out explicitly. Paired with the column above it isolates the text-colour change as the only variable; paired with column 1 it checks that declaring them on the instance behaves the same as inheriting them from the variant.',
    build: (label) => {
      const el = document.createElement('we-button');
      el.setAttribute('variant', 'ghost');
      el.setAttribute('size', 'sm');
      el.textContent = label;
      (el as unknown as { hoverProps: Record<string, string> }).hoverProps = {
        bg: 'neutral-100',
        color: 'neutral-900',
      };
      return el;
    },
    painted: (host) => host.shadowRoot?.querySelector('[part="base"]') ?? null,
  },
  {
    id: 'instant',
    title: 'plain <button> · transition: none',
    isolates:
      'No animation at all — the hover colour is simply on or off. A flicker here cannot be a transition artefact, because there is no transition: it would mean the repaint itself, or the pointer losing and regaining the button.',
    build: (label) => {
      const el = document.createElement('button');
      el.className = 'control instant';
      el.textContent = label;
      return el;
    },
    painted: (host) => host,
  },
  {
    id: 'fadein',
    title: 'plain <button> · fades in, snaps out',
    isolates:
      'Leaves no trail: a button you have left is un-highlighted the instant you leave it. Clean here means the flicker is the trailing fade-out, not the fade-in.',
    build: (label) => {
      const el = document.createElement('button');
      el.className = 'control fadein';
      el.textContent = label;
      return el;
    },
    painted: (host) => host,
  },
  {
    id: 'textfade',
    title: 'plain <button> · fades in, snaps out, background AND text',
    isolates:
      'The decisive one. Every clean bare-CSS column so far changed the background only — the :hover rule in this app never touched `color`. we-button’s ghost variant changes both, and that is the last uncontrolled difference between a column that is clean and one that is not. Same shape, same timing, one extra property.',
    build: (label) => {
      const el = document.createElement('button');
      el.className = 'control fadein textfade';
      el.textContent = label;
      return el;
    },
    painted: (host) => host,
  },
  {
    id: 'blank',
    title: 'plain <button> · no text at all',
    isolates:
      'The same fade with nothing to rasterise. If a bare block never flickers while an identical button carrying a label does, the effect is in how the text is drawn over a changing backdrop — which is invisible to computed style and to geometry alike, and would explain a capture that is clean in every number it records.',
    build: () => {
      const el = document.createElement('button');
      el.className = 'control fadein blank';
      return el;
    },
    painted: (host) => host,
  },
];

// ── page ────────────────────────────────────────────────────────────────────

const root = document.getElementById('root')!;
let theme: ThemeName = 'light';
applyThemeVars(document.documentElement, THEME_PRESETS[theme].parameters);

const header = document.createElement('header');
header.innerHTML = `
  <h1>Hover flicker probe</h1>
  <p>
    Sweep your pointer down the columns. The instant you see a flicker, press
    <kbd>space</kbd> — the probe dumps the window leading up to it, with your keypress at 0.
    While pointing at a button, <kbd>d</kbd> lists every computed property that hovering it changes.
  </p>
  <p class="quiet">
    It measures the painted colour every frame rather than listening for transition events, because a
    flicker can be one wrong frame with no transition attached to it.
  </p>
`;

const bar = document.createElement('div');
bar.className = 'bar';

const themeButton = document.createElement('button');
themeButton.className = 'chrome';
themeButton.textContent = 'Toggle theme';
themeButton.addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  applyThemeVars(document.documentElement, THEME_PRESETS[theme].parameters);
});

const sawIt = document.createElement('button');
sawIt.className = 'chrome primary';
sawIt.textContent = 'I saw it (space)';

/*
  How far back the key looks.

  Left as a control rather than a constant because it trades two things off against each other and
  the right balance is a matter of how you happen to be testing. Too short and a slow hand misses the
  event entirely, which is indistinguishable in the output from nothing having happened. Too long and
  more unrelated hovers land in the same window. Two seconds is the default on the grounds that a
  missed capture wastes a run and a noisy one does not — the run-length collapse keeps it readable.
*/
const windowChoice = document.createElement('select');
windowChoice.className = 'chrome';
for (const [label, value] of [
  ['look back 0.5s', '500'],
  ['look back 1s', '1000'],
  ['look back 2s', '2000'],
] as const) {
  const option = document.createElement('option');
  option.textContent = label;
  option.value = value;
  if (value === '2000') option.selected = true;
  windowChoice.append(option);
}

const counters = document.createElement('span');
counters.className = 'counters';

bar.append(themeButton, sawIt, windowChoice, counters);

const grid = document.createElement('div');
grid.className = 'grid';

const surfaces: Surface[] = [];
const pending: Array<() => void> = [];
const readouts: Array<() => void> = [];

for (const row of ROWS) {
  const column = document.createElement('section');
  column.className = 'column';

  const title = document.createElement('h2');
  title.textContent = row.title;

  const tag = document.createElement('span');
  tag.className = row.underTest ? 'tag test' : 'tag reference';
  tag.textContent = row.underTest ? 'under test — design system' : 'reference — this app’s own CSS';

  const isolates = document.createElement('p');
  isolates.className = 'quiet';
  isolates.textContent = row.isolates;

  /*
    What this column is actually running, read back off the element.

    The resting transition is the one that matters: it governs leaving the hover, which is where the
    flicker lives. `0s` here means the departure snaps. Reading it from the DOM rather than trusting
    the source is the point — a stale Vite pre-bundle served a design system 37 minutes out of date
    without any sign that it had, and no amount of checking the repository would have shown it.
  */
  const running = document.createElement('code');
  running.className = 'running';

  const stack = document.createElement('div');
  stack.className = 'stack';

  LABELS.forEach((label, index) => {
    const host = row.build(label);
    stack.append(host);
    // A custom element has no shadow root until it upgrades and first renders, so resolving the
    // painted surface has to wait a tick. Doing it eagerly silently watched nothing.
    pending.push(() => {
      const painted = row.painted(host);
      if (painted) surfaces.push({ label: `${row.id}#${index}`, host, painted });
    });
  });

  column.append(title, tag, isolates, running, stack);
  grid.append(column);
  readouts.push(() => {
    /*
      Read from a button that is not currently hovered.

      `getComputedStyle` reports whichever rule matches *now*, so sampling a button with the pointer
      on it read the hover rule's 0.05s and flashed the readout red — the diagnostic reporting the
      fault it exists to rule out, for the second time, in a second way. "On leaving" is a claim about
      the resting rule, so it has to be read from something at rest.
    */
    const host = ([...stack.children] as HTMLElement[]).find((el) => !el.matches(':hover'));
    const first = host && row.painted(host);
    if (!first) return;
    const style = getComputedStyle(first);
    const durations = [...new Set(style.transitionDuration.split(',').map((d) => d.trim()))].join(' / ');
    const instant = durations === '0s';
    running.textContent = `on leaving: ${durations || 'none'}${instant ? '  ✓ snaps' : '  ← fades, will trail'}`;
    running.classList.toggle('good', instant);
  });
}

/*
  One button, on its own, with nothing near it.

  Every column is a list, so no column can tell a defect in a single transition from an artefact of
  several overlapping. Hover this one and stay: a flicker on entry, with no neighbour able to be
  mid-fade at the same time, means the problem is inside one transition. Never flickering here while
  the lists flicker constantly means the opposite — it is the trail, and no individual transition is
  wrong at all.
*/
const solo = document.createElement('section');
solo.className = 'solo';
const soloTitle = document.createElement('h2');
soloTitle.textContent = 'One button, alone · 50ms ease-out';
const soloNote = document.createElement('p');
soloNote.className = 'quiet';
soloNote.textContent =
  'Hover it and stay, then hover it repeatedly. Nothing else is within reach, so nothing else can be fading at the same time.';
const soloButton = document.createElement('button');
soloButton.className = 'control big';
soloButton.textContent = 'Hover me on my own';
solo.append(soloTitle, soloNote, soloButton);
pending.push(() => surfaces.push({ label: 'solo', host: soloButton, painted: soloButton }));

const findings = document.createElement('section');
findings.className = 'findings';
findings.innerHTML = '<h2>Detected</h2><p class="quiet">Nothing yet.</p>';

const dump = document.createElement('pre');
dump.className = 'dump';

root.append(header, bar, grid, solo, findings, dump);

// ── instrument ──────────────────────────────────────────────────────────────

let probe: Probe;

requestAnimationFrame(() => {
  pending.forEach((resolve) => resolve());
  /*
    Re-read on a timer, never once.

    Reading a single time at load caught the window `applyThemeVars` opens around a theme change and
    then froze on it, so the page reported a 0.25s departure that had already been withdrawn — a
    diagnostic confidently asserting the exact fault it exists to rule out, which is worse than having
    no diagnostic. Anything derived from live CSS has to be sampled like the CSS is live.
  */
  const refreshReadouts = () => readouts.forEach((read) => read());
  refreshReadouts();
  setInterval(refreshReadouts, 500);
  probe = startProbe(surfaces);

  probe.onAnomaly = (anomaly: Anomaly) => {
    const list = findings.querySelector('ul') ?? document.createElement('ul');
    if (!list.parentElement) {
      findings.querySelector('p')?.remove();
      findings.append(list);
    }
    const item = document.createElement('li');
    item.innerHTML = `<b>${anomaly.kind}</b> · <code>${anomaly.surface}</code> — ${anomaly.detail}`;
    list.prepend(item);
    while (list.children.length > 40) list.lastElementChild?.remove();
    // A flash on the page itself, so a detection is noticeable without watching the console — and so
    // you can tell whether what the probe caught is the same event your eye caught.
    document.body.classList.add('flash');
    setTimeout(() => document.body.classList.remove('flash'), 120);
  };

  setInterval(() => {
    counters.textContent = `${probe.frames} frames · ${probe.dropped} dropped · ${probe.anomalies.length} detected · ${surfaces.length} surfaces watched`;
  }, 250);
});

function sawItNow() {
  dump.textContent = probe?.report(performance.now(), 'you saw it', Number(windowChoice.value)) ?? '';
  dump.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

sawIt.addEventListener('click', sawItNow);
window.addEventListener('keydown', (event) => {
  // D, while pointing at a button: enumerate every computed property the hover changes. Space answers
  // "what did the colour do"; this answers "what is there to look at in the first place".
  if (event.code === 'KeyD') {
    event.preventDefault();
    dump.textContent = probe?.styleDiff() ?? '';
    return;
  }
  if (event.code !== 'Space') return;
  // Space would otherwise activate whichever button has focus, which repaints it and pollutes the
  // very window being captured.
  event.preventDefault();
  sawItNow();
});
