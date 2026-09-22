/**
 * A panel says its own name, in one treatment, at the top.
 *
 * Seventeen panel bodies had arrived at five: the reference caps label, a `heading-sm`, a `fontSize:
 * 500` bold heading in a second bordered bar under the host's own, a section heading standing in for
 * a name four children down, and two panels that named themselves nowhere at all. Nothing was wrong
 * with any one of them in isolation, which is exactly why they diverged — the cost only shows when
 * they are open beside each other.
 *
 * Asserted on the expansion rather than on how it draws, for the reason the picker's tests are:
 * what is being protected is the recipe, and a recipe restated is a recipe that drifts.
 */
import { describe, expect, it } from 'vitest';

import {
  PANEL_TITLE_PROPS,
  panelHeader,
  panelScroll,
  panelShell,
  SECTION_LABEL_PROPS,
  sectionLabel,
} from './panelShell.ts';

describe('a panel header', () => {
  it('is the muted capitalised label, whatever the caller passes', () => {
    const props = (panelHeader({ title: 'Inspector' }).children?.[0] as { props: Record<string, unknown> }).props;

    expect(props).toMatchObject(PANEL_TITLE_PROPS);
  });

  it('takes an expression, because a panel can be about more than one thing', () => {
    /*
      The transcript is "Transcript" or "Past call" depending on the address, which is why the title
      could never move into the host's titlebar — that name comes from a static declaration.

      The fixture reads a local rather than that panel's actual `routeStore` expression: this package
      names no store, and its portability guard reads the sources rather than trusting the fragments
      to be honest about it. A test is a source.
    */
    const title = { $: "local.past ? 'Past call' : 'Transcript'" };
    const header = panelHeader({ title });

    expect((header.children?.[0] as { children: unknown[] }).children).toEqual([title]);
  });

  it('pushes an aside to the far edge rather than up against the name', () => {
    const aside = { type: 'we-button' };
    const header = panelHeader({ title: 'Calls', aside });
    const titleProps = (header.children?.[0] as { props: Record<string, unknown> }).props;

    expect(titleProps.flex).toBe('1');
    expect(header.children?.[1]).toBe(aside);
  });

  it('never shrinks', () => {
    // A panel is a scroll region under a fixed name. A header that can be squeezed is a name that
    // disappears exactly when there is most content to be lost in.
    expect(panelHeader({ title: 'Inspector' }).props?.flex).toBe('0 0 auto');
  });

  it('holds a control’s height where an aside is declared, and only there', () => {
    /*
      Almost every aside is conditional — a record button on the live call, a switch while a call
      can decide — so without a floor the header is as tall as its own text in between. Continuing a
      call empties the slot for the second a microphone takes to come up: the title rose by half a
      line, the whole panel followed it, and it dropped back when the button returned.

      Only where an aside exists, so a panel that never has one keeps a header as tall as its name.
    */
    expect(panelHeader({ title: 'Calls', aside: { type: 'we-button' } }).props?.minHeight).toBe(
      'var(--we-component-height-sm)',
    );
    expect(panelHeader({ title: 'Inspector' }).props?.minHeight).toBeUndefined();
  });

  it('keeps an explanation against the name, not against the aside', () => {
    /*
      The glyph is about the word. Left as a third child after a `flex: '1'` title it lands at the
      far edge, beside the switch or the record button, and reads as a control of theirs.
    */
    const aside = { type: 'we-switch' };
    const header = panelHeader({ title: 'Extraction', help: 'A model reads the transcript.', aside });
    const name = header.children?.[0] as { type: string; props: Record<string, unknown>; children: unknown[] };

    expect(name.type).toBe('Row');
    expect(name.props.flex).toBe('1');
    expect((name.children[0] as { props: Record<string, unknown> }).props).toMatchObject(PANEL_TITLE_PROPS);
    expect((name.children[0] as { props: Record<string, unknown> }).props.flex).toBeUndefined();
    expect((name.children[1] as { type: string }).type).toBe('we-tooltip');
    expect(header.children?.[1]).toBe(aside);
  });
});

describe('a section label', () => {
  it('is quieter than a panel own name, so the two do not compete', () => {
    const props = (sectionLabel({ label: 'Extracted' }).children?.[0] as { props: Record<string, unknown> }).props;

    expect(props).toMatchObject(SECTION_LABEL_PROPS);
    // The distinction the extraction panel had no way to draw: its only capitalised line said what
    // the list below held, and with one treatment available that read as the panel's name.
    expect(SECTION_LABEL_PROPS.color).not.toBe(PANEL_TITLE_PROPS.color);
    expect(SECTION_LABEL_PROPS.variant).not.toBe(PANEL_TITLE_PROPS.variant);
  });

  it('holds a small control’s height where an aside is declared, and only there', () => {
    /*
      The header's floor, one tier down, and the key's lens sections are why: the switch that
      reveals a section sits on that section's own heading, and the "Edit" beside it appears only
      once the lens is on. A `we-switch` draws a 16px track, so flicking it grew the row to the
      24px of the button that joined it and the centred heading dropped 4px — the label moving at
      the exact moment attention was on it.

      `xs`, not the header's `sm`: a section's asides are the small end of the set, and `sm` would
      leave visible air under every heading that has one.
    */
    expect(sectionLabel({ label: 'States', aside: { type: 'we-switch' } }).props?.minHeight).toBe(
      'var(--we-component-height-xs)',
    );
    expect(sectionLabel({ label: 'States', aside: { type: 'we-switch' } }).props?.minHeight).not.toBe(
      panelHeader({ title: 'Key', aside: { type: 'we-switch' } }).props?.minHeight,
    );
    expect(sectionLabel({ label: 'Extracted' }).props?.minHeight).toBeUndefined();
  });
});

describe('a panel shell', () => {
  it('opens with the header, before anything conditional', () => {
    // The failure this prevents: a title below a `$if`, which is missing in the state that most
    // needs a name — the one where the panel is explaining why it has nothing to show.
    const shell = panelShell({ title: 'Extraction', children: [{ type: '$if' }] });

    expect(shell.children?.[0]).toEqual(panelHeader({ title: 'Extraction' }));
  });

  it('hands the header everything it takes', () => {
    // The options type extends the header's, so a new header option typechecks on the shell and
    // is silently dropped unless it is forwarded — which is how `help` first shipped as nothing.
    const aside = { type: 'we-switch' };
    const shell = panelShell({ title: 'Extraction', help: 'A model reads the transcript.', aside, children: [] });

    expect(shell.children?.[0]).toEqual(
      panelHeader({ title: 'Extraction', help: 'A model reads the transcript.', aside }),
    );
  });

  it('clips, and leaves the scrolling to its content', () => {
    // A panel is given a box by the host and stays inside it; a `we-scroll-area` in the content is
    // what lets the header stay put while the list under it moves.
    expect(panelShell({ title: 'Notes', children: [] }).props?.overflow).toBe('hidden');
  });

  it('uses one padding, so panels side by side line up', () => {
    // There were two, `300` and `400`, split between the templates and the modules, which nobody
    // chose between and which reads as a wobble the moment two panels share an edge.
    const shell = panelShell({ title: 'Notes', children: [] });

    expect(shell.props?.p).toBe('300');
    expect(shell.props?.gap).toBe('300');
  });
});

describe('a panel scroll region', () => {
  const props = (opts: Parameters<typeof panelScroll>[0] = { children: [] }) =>
    panelScroll(opts).props as Record<string, string>;

  it('pulls out through the panel padding, and puts it back inside', () => {
    /*
      The pair is the whole fragment, and either alone is wrong. The negative margin is what takes
      the scroller — and so its bar — out to the panel's real edge; the padding is what keeps the
      content where it was. Written apart they drift: a panel that bleeds and does not re-pad runs
      its text under the bar.
    */
    const p = props();

    expect(p.mr).toContain('var(--we-space-300)');
    expect(p.pr).toContain('var(--we-space-300)');
  });

  it('holds the bar off the edge by the gap the thumb does not already give', () => {
    /*
      The thumb is already held off its own track, so taking the track to the edge leaves only that
      clearance — two pixels, which read as too near the frame. The track carries the remainder, so
      what somebody sees is the whole `THUMB_EDGE_GAP` however far a theme pulls its thumb in.

      Three, because the slack either side of the thumb adds to six: a gap at the edge is a gap
      taken from the text, and only half of it is the middle.
    */
    expect(props().mr).toBe('calc(max(0px, calc(3px - var(--we-scrollbar-thumb-inset))) - var(--we-space-300))');
  });

  it('measures the inner padding against the bar and the track, so the four sides come out equal', () => {
    /*
      A scroll container puts its bar at its own edge and its `padding-right` between the content
      and the bar — so the content's distance from the panel edge is the track's offset plus the
      reserved gutter plus that padding, and the padding it wants is whatever is left of the panel's
      inset. Every term is a variable: a theme that widened the bar or pulled its thumb in would
      otherwise push every panel's text off-centre, silently, and only on the side with a bar.
    */
    expect(props().pr).toBe(
      'max(0px, calc(var(--we-space-300) - max(0px, calc(3px - var(--we-scrollbar-thumb-inset))) - var(--we-scrollbar-width)))',
    );
  });

  it('reserves the bar whether or not one is showing', () => {
    // Nothing can ask an element whether it is currently overflowing, so this is the only way to
    // hold content still — and it is what makes the padding above a constant rather than a figure
    // that depends on the length of a list.
    expect(props().scrollbarGutter).toBe('stable');
  });

  it('never sets a width, which would defeat the bleed', () => {
    /*
      It widens by being stretched: an auto-width flex item takes its container's width plus the
      negative margin. `width: '100%'` resolves against the container's content box instead, so the
      element keeps its old width and only its margin edge moves — the bar stays where it was, and
      nothing on screen says why.
    */
    expect(props().width).toBeUndefined();
  });

  it('follows the panel it is in when that panel pads itself differently', () => {
    const p = props({ children: [], inset: '400' });

    expect(p.mr).toContain('var(--we-space-400)');
    expect(p.pr).toContain('var(--we-space-400)');
    expect(p.mr).not.toContain('--we-space-300');
    expect(p.pr).not.toContain('--we-space-300');
  });

  it('carries the scroller options a panel actually uses, and no others', () => {
    // `pin`/`jump` are the transcript's: it follows a live tail and needs a way back down. A panel
    // that asks for neither should not carry the attributes at all.
    expect(props({ children: [], pin: 'end', jump: 'both' })).toMatchObject({ pin: 'end', jump: 'both' });
    expect(props()).not.toHaveProperty('pin');
    expect(props()).not.toHaveProperty('jump');
  });
});
