/**
 * Where the call's sound comes from — an invariant no type can hold and nothing else asserts.
 *
 * A call's audio used to come out of the participant tiles' `<video>` elements, which are the most
 * conditional thing in the module: a tile renders one only while that peer has a picture, the stage
 * renders tiles only while it is open, and the host unmounts a dock nobody has open. So the sound
 * disappeared for three unrelated reasons, each of which looks correct in the file it lives in.
 *
 * These tests pin the arrangement that fixed it: the audio hangs off `active` and the pictures stay
 * silent. Structural rather than behavioural, because the failure is structural — every piece
 * rendered exactly as written, in the wrong dependency.
 */
import { moduleCapabilities, type ModulePart } from '@we/module-shared';
import type { SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { callModule, createModule } from './index';

/** Every node in a tree, so a test can ask about a subtree without knowing where it sits. */
function walk(node: unknown, out: SchemaNode[] = []): SchemaNode[] {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  const record = node as Record<string, unknown>;
  if (typeof record.type === 'string') out.push(record as unknown as SchemaNode);
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') walk(value, out);
  }
  return out;
}

const slotNodes = (): SchemaNode[] => (callModule.contributes?.slots ?? []).map((slot) => slot.node);
const stageNode = (): SchemaNode =>
  callModule.contributes?.panels?.find((panel) => panel.name === 'stage')?.node as SchemaNode;
/** Chrome and the stage — where the bar lives now that it has moved inside it. */
const chrome = (): SchemaNode[] => [...slotNodes(), stageNode()];
const part = (name: string) => callModule.contributes?.parts?.[name];

describe('audio', () => {
  it('plays from the chrome, which is mounted for the whole call', () => {
    // Not from the dock: `dockFrame` unmounts a panel with no edge, deliberately, so a stage nobody
    // is watching stops decoding video. Audio in there went with it.
    const sinks = walk(slotNodes()).filter((node) => node.type === 'we-audio');
    expect(sinks).toHaveLength(1);
    expect((sinks[0].props as Record<string, unknown>).autoplay).toBe(true);
  });

  it('depends on being in a call and on nothing else', () => {
    // Specifically not on `stageOpen`, `hasPicture`, or a placement — the three things that were
    // each, separately, able to silence a working call.
    const sinkSlot = slotNodes().find((node) => walk(node).some((child) => child.type === 'we-audio'));
    const condition = JSON.stringify((sinkSlot?.props as Record<string, unknown>)?.condition);

    expect(condition).toBe(JSON.stringify({ $: 'modules.call.active' }));
  });

  it('leaves your own tile out of it', () => {
    // Your tile is your own microphone. Played back, it is a feedback loop — which is why the self
    // tile's video was the one that was always muted.
    const sink = walk(slotNodes()).find((node) => node.type === 'we-audio');
    const loop = walk(slotNodes()).find((node) => node.type === '$each' && walk(node).includes(sink as SchemaNode));

    expect(JSON.stringify((loop?.props as Record<string, unknown>)?.items)).toContain('isSelf: false');
  });

  it('keeps every tile silent, so nobody is decoded twice', () => {
    // An unmuted tile beside the sink is the same voice from two decoders, slightly apart.
    const videos = walk(part('tile')).filter((node) => node.type === 'we-video');

    expect(videos).not.toHaveLength(0);
    for (const video of videos) expect((video.props as Record<string, unknown>).muted).toBe(true);
  });

  it('rounds a picture only by the tile it sits in', () => {
    // A video takes the theme's surface radius by default; inside a tile that clips, that cut the
    // picture's corners deeper than the tile's own wherever a theme is rounder than the tile.
    const tile = walk(part('tile')).find((node) => (node.props as Record<string, unknown>)?.overflow === 'hidden');
    expect(tile).toBeDefined();
    const videos = walk(tile!).filter((node) => node.type === 'we-video');
    expect(videos).not.toHaveLength(0);
    for (const video of videos) expect((video.props as Record<string, unknown>).r).toBe('0');
  });
});

/** The nodes from the root down to `target`, so a test can ask what a node is gated by. */
function lineage(node: unknown, target: SchemaNode, trail: SchemaNode[] = []): SchemaNode[] | undefined {
  if (node === target) return trail;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = lineage(item, target, trail);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== 'object') return undefined;
  const record = node as Record<string, unknown>;
  const next = typeof record.type === 'string' ? [...trail, record as unknown as SchemaNode] : trail;
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      const found = lineage(value, target, next);
      if (found) return found;
    }
  }
  return undefined;
}

const props = (node: SchemaNode | undefined): Record<string, unknown> => (node?.props ?? {}) as Record<string, unknown>;

describe('the bar keeps to the screen', () => {
  it('centres inside a strip spanning the content, rather than positioning itself', () => {
    // A box centred by `translateX(-50%)` overhangs both sides equally once the content is narrower
    // than it, and the half over the sidebar leaves the window — hang-up button first. A strip
    // pinned at the content's edges, with `safe center`, is the same centring with a clamp.
    const strips = walk(slotNodes()).filter((node) => props(node).position === 'fixed');
    expect(strips.length).toBeGreaterThan(0);

    for (const strip of strips) {
      expect(props(strip).transform).toBeUndefined();
      expect(props(strip).left).toContain('--we-chrome-left');
      expect(props(strip).right).toContain('--we-chrome-right');

      const surface = walk(strip).find((node) => node.type === '$surface');
      const styles = props(surface).styles as Record<string, string> | undefined;
      expect(styles?.['justify-content']).toBe('safe center');
      // Which end the bar pins to when it cannot fit is the host's to say — see `--we-chrome-give`.
      expect(styles?.['flex-direction']).toContain('--we-chrome-give');
    }
  });

  it('lets clicks through the strip and back on at the bar', () => {
    // The strip spans the whole edge. Left opaque to the pointer it would swallow every click along
    // the bottom of the content, so it passes them through and each child switches them back on.
    const strips = walk(slotNodes()).filter((node) => props(node).position === 'fixed');
    for (const strip of strips) {
      expect(props(strip).pointerEvents).toBe('none');
      const surface = walk(strip).find((node) => node.type === '$surface');
      const child = (surface?.children as SchemaNode[])[0];
      expect(props(child).pointerEvents).toBe('auto');
    }
  });

  it('paints above every panel, a full-screen call included', () => {
    // Panels count up from `sticky` by how recently they were touched, and maximising touches. On
    // `sticky` the bar lost to the full-screen call it controls and the hang-up button went under it.
    const strips = walk(slotNodes()).filter((node) => props(node).position === 'fixed');
    for (const strip of strips) expect(props(strip).zIndex).toBe('chrome');
  });
});

describe('the More menu', () => {
  /** The menu itself — a `we-menu` inside the bar's `we-popover`, so children land in its light DOM. */
  const menu = (): SchemaNode => walk(chrome()).find((node) => node.type === 'we-menu') as SchemaNode;

  /** `we-menu-item` lines in the menu, optionally filtered by the action they invoke. */
  const items = (action?: string): SchemaNode[] =>
    walk(menu()).filter(
      (node) =>
        node.type === 'we-menu-item' &&
        (action === undefined || JSON.stringify(props(node).onSelect) === JSON.stringify({ $invoke: action })),
    );

  const buttonFor = (action: string): SchemaNode =>
    walk(chrome()).find(
      (node) =>
        node.type === 'we-button' && JSON.stringify(props(node).onClick) === JSON.stringify({ $invoke: action }),
    ) as SchemaNode;

  it('holds screen share, show/hide and solo as menu items', () => {
    /*
      Behind the menu at every width, not only below `base` — the bar shows your own devices
      directly and puts everything else a press away. A toggle in the menu keeps the same action as
      the button it replaces, so choosing it there is indistinguishable from pressing the square.
    */
    expect(menu(), 'no we-menu in the bar').toBeDefined();
    for (const action of ['modules.call.toggleScreenShare', 'modules.call.toggleStage', 'modules.call.toggleSolo']) {
      expect(items(action), action).toHaveLength(1);
    }
  });

  it('keeps those three out of the row entirely, so nothing is shown twice', () => {
    // No width shows them as buttons any more — the old `whenRoomy` fold is gone with the split it
    // maintained: a control was either a square or a line at a given width, and a bug could lose it.
    for (const action of ['modules.call.toggleScreenShare', 'modules.call.toggleStage', 'modules.call.toggleSolo']) {
      expect(buttonFor(action), action).toBeUndefined();
    }
  });

  it('keeps mute, camera and hang-up directly in the row', () => {
    // They are the call. A menu between a person and their microphone is one step too many at the
    // moment they need it — so their buttons are row children, never menu items.
    for (const action of ['modules.call.toggleAudio', 'modules.call.toggleVideo', 'modules.call.leave']) {
      const button = buttonFor(action);
      expect(button, action).toBeDefined();
      expect(
        (lineage(chrome(), button) ?? []).some((node) => node.type === 'we-menu'),
        `${action} ended up inside the menu`,
      ).toBe(false);
    }
  });

  it('keeps contributed controls in the row', () => {
    // This module cannot put another module's chrome in its menu — it does not know what that chrome
    // is, and a contributed square may be the loudest thing in the bar (a red "recording" button,
    // say) precisely because it has to be seen.
    const slot = walk(chrome()).find(
      (node) => node.type === '$slot' && props(node).anchor === 'call-controls',
    ) as SchemaNode;
    expect(slot).toBeDefined();
    expect(
      (lineage(chrome(), slot) ?? []).some((node) => node.type === 'we-menu'),
      'the contributed-controls slot ended up inside the menu',
    ).toBe(false);
  });

  it('opens a second anchor inside the menu, for lines another module writes as menu items', () => {
    /*
      Buttons stay in the row — but a contribution that *is* a line of text and an icon is better
      placed in the menu, and "share your pointer" is exactly that. The `call-menu` anchor is where
      those land, which is how the call can move less-used controls behind More without learning
      which module owns them.
    */
    const slot = walk(menu()).find((node) => node.type === '$slot' && props(node).anchor === 'call-menu') as SchemaNode;
    expect(slot, 'no call-menu slot inside the More menu').toBeDefined();
  });

  it('dismisses on an action line, and not on a toggle', () => {
    /*
      Choosing "Camera and microphone…" or "Leave and start a new call" is done once, so the menu
      should go away with it — `we-menu-item`'s `dismiss` fires the popover's own dismiss contract.
      A toggle is deliberately different: it is something a person may want to flip twice, so it
      leaves the menu open.
    */
    const devices = items().find((node) =>
      JSON.stringify(props(node).onSelect).includes('modules.call.openDeviceSettings'),
    );
    const start = items().find((node) => JSON.stringify(props(node).onSelect).includes('modules.call.startCall'));
    expect(devices, 'no devices line').toBeDefined();
    expect(start, 'no start-another line').toBeDefined();
    expect(props(devices!).dismiss).toBe(true);
    expect(props(start!).dismiss).toBe(true);
    for (const toggle of items('modules.call.toggleScreenShare').concat(items('modules.call.toggleStage'))) {
      expect(props(toggle).dismiss).toBeUndefined();
    }
  });

  it('lets "Video" hide only the tiles, never the panel the menu itself sits in', () => {
    /*
      The line used to reflect `stageOpen`, so choosing it hid the stage — and with it the menu,
      mute and Leave, while the call and its microphone carried on. What it governs is the
      pictures: `tilesHidden`, a fact about the tiles rather than about the panel holding them.
    */
    const video = items('modules.call.toggleStage');
    expect(video, 'no Video line in the menu').toHaveLength(1);
    const json = JSON.stringify(video[0]);
    expect(json).toContain('modules.call.tilesHidden');
    expect(json).not.toContain('modules.call.stageOpen');
  });
});

/**
 * The gear, below `base`: a 390px bar has no room for it, but the settings still have to be
 * reachable — which is the same job the menu already does for screen share, Video and solo.
 *
 * "Fold the gear into More below the narrow breakpoint" is also what unclips Leave: at `base` the
 * row holds mute, camera, the contributed slot, More, the count and Leave and nothing else, so the
 * back-to-call control of the elsewhere bar fits beside them.
 */
describe('the gear below the narrow breakpoint', () => {
  /** The control row — the one holding the contributed-controls slot as a direct child. */
  const row = (): SchemaNode =>
    walk(chrome()).find(
      (node) =>
        node.type === 'Row' &&
        ((node.children ?? []) as SchemaNode[]).some(
          (child) => child?.type === '$slot' && props(child).anchor === 'call-controls',
        ),
    ) as SchemaNode;

  const gear = (): SchemaNode =>
    walk(row()).find(
      (node) =>
        node.type === 'we-button' && walk(node).some((icon) => icon.type === 'we-icon' && props(icon).name === 'gear'),
    ) as SchemaNode;

  it('leaves the row below `base`, where its seat costs Leave', () => {
    // The trigger is gated on roomy — not removed, or the settings would open with no way in.
    const trigger = gear();
    expect(trigger, 'no gear in the bar at all').toBeDefined();
    const gate = lineage(row(), trigger)?.find(
      (node) => node.type === '$if' && JSON.stringify(props(node).condition).includes('surface.tier'),
    );
    expect(JSON.stringify(props(gate)?.condition)).toBe(JSON.stringify({ $: "surface.tier != 'base'" }));
  });

  it('shows the way back to the call as an icon below `base`, where its name costs Leave', () => {
    // In a call from another space the back-to-call button joins the row; its name, even
    // truncated, pushed Leave off a 390px bar. The icon stays at every width, the tooltip names it.
    const back = walk(row()).find(
      (node) =>
        node.type === 'we-button' &&
        walk(node).some((icon) => icon.type === 'we-icon' && props(icon).name === 'arrow-bend-up-left'),
    ) as SchemaNode;
    expect(back, 'no back-to-call button in the bar').toBeDefined();
    const name = walk(back).find((node) => node.type === 'we-text') as SchemaNode;
    expect(name, 'no name on the back-to-call button').toBeDefined();
    const gate = lineage(back, name)?.find(
      (node) => node.type === '$if' && JSON.stringify(props(node).condition).includes('surface.tier'),
    );
    expect(JSON.stringify(props(gate)?.condition)).toBe(JSON.stringify({ $: "surface.tier != 'base'" }));
    const icon = walk(back).find((node) => node.type === 'we-icon') as SchemaNode;
    expect(lineage(back, icon)?.some((node) => node.type === '$if')).toBe(false);
    // Icon-only at `base`, so the button carries its own accessible name.
    expect(JSON.stringify(props(back).label)).toContain('Back to the call');
  });

  it('keeps Call settings in the menu at the width that drops it', () => {
    /*
      The line exists *because* the gear is gone — so it is gated on the same tier, negated, and
      reaches the same popover through the store: a menu line cannot write the `local.open` the
      gear used to hold, which is why the flag moved.
    */
    const menu = walk(chrome()).find((node) => node.type === 'we-menu') as SchemaNode;
    const line = walk(menu).find(
      (node) =>
        node.type === 'we-menu-item' &&
        JSON.stringify(props(node).onSelect).includes('modules.call.toggleCallSettings'),
    ) as SchemaNode;
    expect(line, 'no Call settings line in the menu').toBeDefined();
    const gate = lineage(menu, line)?.find(
      (node) => node.type === '$if' && JSON.stringify(props(node).condition).includes('surface.tier'),
    );
    expect(JSON.stringify(props(gate)?.condition)).toBe(JSON.stringify({ $: "surface.tier == 'base'" }));
    // And it is a pick-and-dismiss line, like the other actions — not a toggle.
    expect(props(line).dismiss).toBe(true);
  });

  it('opens the popover off the store, which the menu can reach', () => {
    const popover = walk(chrome()).find((node) => JSON.stringify(node).includes('Call settings')) as SchemaNode;
    expect(JSON.stringify(popover)).toContain('modules.call.settingsOpen');
    // Nothing in it may still write the local the gear used to own — two flags, one panel, is a
    // desync waiting for the second press.
    expect(JSON.stringify(popover)).not.toContain("$setLocal: 'open'");
  });
});

/**
 * The readouts the bar dropped.
 *
 * Two icons duplicated what the settings popover already says in words: a broadcast/graph glyph for
 * the route, and a signal-strength glyph for the quality preference. A glyph with a tooltip is a
 * sentence hiding behind a hover, and these were the bar's only controls that were never pressed —
 * removing them loses nothing a reader could act on, which is the whole reason they could go.
 */
describe('the readouts the bar dropped', () => {
  /** The control row — the one holding the contributed-controls slot as a direct child. */
  const row = (): SchemaNode =>
    walk(chrome()).find(
      (node) =>
        node.type === 'Row' &&
        ((node.children ?? []) as SchemaNode[]).some(
          (child) => child?.type === '$slot' && props(child).anchor === 'call-controls',
        ),
    ) as SchemaNode;

  it('shows no topology or quality control in the row', () => {
    // The settings popover is the one row child allowed to mention either path — it is where the
    // readouts live now, behind the gear. Everything else in the row stays silent on the subject.
    const children = ((row().children ?? []) as SchemaNode[]).filter(
      (child) => !JSON.stringify(child).includes('Call settings'),
    );
    for (const child of children) {
      const json = JSON.stringify(child);
      expect(json).not.toContain('modules.call.topology');
      expect(json).not.toContain('modules.call.qualityPreference');
      expect(json).not.toContain('cycleQuality');
    }
  });

  it('keeps the route and the quality as words inside call settings', () => {
    // "Keep that relay information available inside call settings (or the quality section) as text."
    const settings = walk(chrome()).find((node) => JSON.stringify(node).includes('Call settings')) as SchemaNode;
    const json = JSON.stringify(settings);
    expect(json).toContain('SFU relay');
    expect(json).toContain('Peer-to-peer mesh');
    expect(json).toContain('Quality preference');
  });
});

/**
 * Where the bar lives: inside the call view, under the video — not floating over every page.
 *
 * It used to be `position: fixed` chrome at the bottom of the window, which is where all three of
 * the reported faults came from: centred on the window rather than on the video, scrolled with the
 * page underneath it, and covering whatever a view did not pad for — the last row of the space
 * settings was unreachable and the Feed kept a blank band for it. These pin the new arrangement.
 */
/**
 * Who is in the call is the stage's to show, not the bar's.
 *
 * The bar carried a stack of faces and "N in the call" beside hang-up. The tiles above it already say
 * who is here, each with a name, so the readout was the same fact twice in one panel (Josh, #487).
 */
describe('the bar without a participants readout', () => {
  const row = (): SchemaNode =>
    walk(chrome()).find(
      (node) =>
        node.type === 'Row' &&
        ((node.children ?? []) as SchemaNode[]).some(
          (child) => child?.type === '$slot' && props(child).anchor === 'call-controls',
        ),
    ) as SchemaNode;

  it('draws no stack of faces in the bar', () => {
    expect(walk(row()).filter((node) => node.type === 'AvatarStack')).toEqual([]);
    expect(JSON.stringify(row())).not.toContain('modules.call.tileFaces');
  });

  it('says "in the call" nowhere in the call’s chrome', () => {
    expect(JSON.stringify(chrome())).not.toContain(' in the call"');
  });

  it('keeps the faces the tiles draw, which still read tileFaces', () => {
    expect(JSON.stringify(part('tile'))).toContain('modules.call.tileFaces');
  });
});

describe('where the bar lives', () => {
  /** Every chrome node that is not the stage — where the bar used to float. */
  const offStage = (): SchemaNode[] => slotNodes();

  it('holds the controls inside the stage, beneath the tiles', () => {
    const stage = stageNode();
    // The buttons that are the bar — hang-up, and the contributed-controls slot beside them.
    const leave = walk(stage).find(
      (node) => JSON.stringify(props(node).onClick) === JSON.stringify({ $invoke: 'modules.call.leave' }),
    );
    expect(leave, 'no leave button inside the stage').toBeDefined();
    expect(
      walk(stage).some((node) => node.type === '$slot' && props(node).anchor === 'call-controls'),
      'no contributed-controls slot inside the stage',
    ).toBe(true);

    // Beneath the tiles literally: the grid and the row holding the controls share the stage's column.
    const grid = walk(stage).find((node) => node.type === 'Grid');
    const row = walk(stage).find((node) => node.type === 'Row' && lineage(stage, leave as SchemaNode)?.includes(node));
    expect(grid, 'no tile grid in the stage').toBeDefined();
    expect(row, 'the controls are not a row beside the grid').toBeDefined();
    // The grid sits inside the same column as the controls — through its `tilesHidden` gate now,
    // which is a node between them rather than a different parent.
    expect(lineage(stage, grid!)?.some((node) => node.type === 'Column')).toBe(true);
  });

  it('floats nothing across the bottom of the window, except the strip standing in for a closed stage', () => {
    // No fixed strip may hold a call control any more — that is the whole complaint, with one
    // stated exception: the stage's own stand-in, which exists only while a call outlives its panel.
    const floating = walk(offStage()).filter(
      (node) =>
        props(node).position === 'fixed' &&
        walk(node).some(
          (child) =>
            JSON.stringify(props(child).onClick) === JSON.stringify({ $invoke: 'modules.call.leave' }) ||
            JSON.stringify(props(child).onClick) === JSON.stringify({ $invoke: 'modules.call.toggleAudio' }),
        ),
    );
    // Whatever qualifies has to be gated on "in a call and no stage to put the controls in" — any
    // other floating control is the bug this test was written against.
    for (const node of floating) {
      const gated = walk(offStage()).some(
        (gate) =>
          gate.type === '$if' &&
          walk(gate).includes(node) &&
          JSON.stringify(props(gate).condition) ===
            JSON.stringify({ $: 'modules.call.active && !modules.call.stageOpen' }),
      );
      expect(gated, 'a floating call control outside the stage-closed strip').toBe(true);
    }
    expect(floating.length, 'the strip exists at all').toBeGreaterThan(0);
  });

  it('reserves no band for a bar that no longer floats', () => {
    // The reserve existed so floating panels and page bottoms kept clear of the bar. With the bar
    // inside the stage there is nothing to clear, and a band still declared is the Feed's blank
    // space all over again.
    expect(callModule.contributes?.reserve).toBeUndefined();
  });

  it('wears the host’s surface rather than wrapping itself in a second', () => {
    /*
      `dockFrame` already renders every panel inside a `$surface` — it is how the bar reads
      `surface.tier`, and the duplicate underneath bought nothing but a second container-query
      box the theme had to style twice. One surface per panel, the host's own.
    */
    const stage = stageNode();
    const surfaces = walk(stage).filter((node) => node.type === '$surface');
    expect(surfaces, 'a second $surface inside the panel the host already surfaces').toHaveLength(0);
    // And the bar still reads the tier the host's own surface publishes — that is the one thing
    // the removed wrapper was load-bearing for.
    expect(JSON.stringify(stage)).toContain('surface.tier');
  });
});

/**
 * The panel can be closed while the call is still going.
 *
 * The stage's titlebar close is the one way to put the stage away without leaving the call — and it
 * does not end the call: the microphone, and so audio, lives in chrome mounted by `active`, not by
 * `stageOpen`. What a closed stage may never take with it is the means to mute or hang up, so a
 * compact strip stands in at the bottom of the view while, and only while, the call runs and the
 * stage is not on screen.
 */
describe('when the stage is put away mid-call', () => {
  /**
   * The strip — the `$if` in chrome gated on `active && !stageOpen`. Nothing else under the chrome
   * slots reads `stageOpen`, so the gate is its identifying mark.
   */
  const strip = (): SchemaNode =>
    walk(chrome()).find(
      (node) => node.type === '$if' && JSON.stringify(props(node).condition).includes('modules.call.stageOpen'),
    ) as SchemaNode;

  it('shows a compact strip only while in a call and the stage is not visible', () => {
    expect(strip(), 'no stage-closed fallback strip in chrome').toBeDefined();
    // The same condition, read the other way: while the stage is up the strip must not exist —
    // nothing reserved, nothing overlapping the stage's own controls.
    const gate = JSON.stringify(props(strip()).condition);
    expect(gate).toContain('modules.call.active');
    expect(gate).toContain('!modules.call.stageOpen');
  });

  it('keeps mute, hang-up and the way back to the stage on the strip', () => {
    for (const action of ['modules.call.toggleAudio', 'modules.call.leave', 'modules.call.goToCall']) {
      expect(
        walk(strip()).some(
          (node) =>
            JSON.stringify(props(node).onClick) === JSON.stringify({ $invoke: action }) ||
            JSON.stringify(props(node).onSelect) === JSON.stringify({ $invoke: action }),
        ),
        `the strip lost ${action}`,
      ).toBe(true);
    }
  });

  it('hides the pictures, not the row that holds the controls', () => {
    /*
      `toggleStage` now means "show the tiles or don't" — `tilesHidden` gates the grid and only the
      grid. The controls' whole ancestry must stay ungated on it, or hiding video takes mute and
      Leave with it and the bug is back under another name.
    */
    const stage = stageNode();
    const grid = walk(stage).find((node) => node.type === 'Grid') as SchemaNode;
    const gateOn = (node: SchemaNode | undefined): boolean =>
      JSON.stringify(props(node as SchemaNode)?.condition ?? null).includes('tilesHidden');
    expect(lineage(stage, grid)!.concat(grid).some(gateOn), 'the tile grid is not gated on tilesHidden').toBe(true);

    const leave = walk(stage).find(
      (node) => JSON.stringify(props(node).onClick) === JSON.stringify({ $invoke: 'modules.call.leave' }),
    ) as SchemaNode;
    expect(lineage(stage, leave)!.concat(leave).some(gateOn), 'a control ended up inside the tilesHidden gate').toBe(
      false,
    );
  });
});

/**
 * The order of the bar, which is a readability decision and therefore assertable.
 *
 * Nothing here was caught by a test before, because every existing one asks whether a control is
 * *present* and none asks where. That is how two identical-looking `−  N  +` triples ended up either
 * side of the fold button: each was correct on its own and the row was not.
 */
describe('how the bar reads left to right', () => {
  /** The control row — the one holding the contributed-controls slot as a direct child. */
  const row = (): SchemaNode =>
    walk(chrome()).find(
      (node) =>
        node.type === 'Row' &&
        ((node.children ?? []) as SchemaNode[]).some(
          (child) => child?.type === '$slot' && props(child).anchor === 'call-controls',
        ),
    ) as SchemaNode;

  /** One recognisable token per child of the row, in order. */
  const reading = (): string[] =>
    ((row().children ?? []) as SchemaNode[]).map((child) => {
      const inner = walk(child);
      if (child.type === '$slot') return `slot:${String(props(child).anchor)}`;
      if (inner.some((node) => node.type === '$slot' && props(node).anchor === 'call-dev')) return 'dev';
      if (child.type === 'we-divider') return 'divider';
      if (inner.some((node) => node.type === 'we-popover' && walk(node).some((m) => m.type === 'we-menu')))
        return 'menu';
      const acted = inner.find((node) => typeof (props(node).onClick as { $invoke?: string })?.$invoke === 'string');
      return acted ? String((props(acted).onClick as { $invoke: string }).$invoke) : String(child.type ?? '');
    });

  it('puts the menu after the contributed controls it cannot hold', () => {
    const order = reading();
    // The row's own region ends at the contributed slot; everything behind More follows it.
    expect(order.indexOf('menu')).toBeGreaterThan(order.indexOf('slot:call-controls'));
  });

  it('puts the development group last, after everything a shipped build has', () => {
    const order = reading();
    const dev = order.indexOf('dev');
    expect(dev).toBeGreaterThan(-1);
    /*
      The whole arrangement in one assertion: a user's bar and a developer's differ by one trailing
      group. So nothing shipped may follow it except the rule and the hang-up that close the row.
    */
    expect(order.slice(dev + 1)).toEqual(['divider', 'modules.call.leave']);
    expect(order.indexOf('menu')).toBeLessThan(dev);
    expect(order.indexOf('slot:call-controls')).toBeLessThan(dev);
  });

  it('opens the development region straight after its own harness, so the two sit together', () => {
    const group = walk(row()).find(
      (node) =>
        node.type === 'Row' &&
        ((node.children ?? []) as SchemaNode[]).some(
          (child) => child?.type === '$slot' && props(child).anchor === 'call-dev',
        ),
    ) as SchemaNode;
    const children = (group.children ?? []) as SchemaNode[];

    /*
      Adjacency is the point, and it is the reason the region exists rather than an `order` in the
      control region: contributions land at a single point, so this module's triple could never be
      threaded in between another module's controls.

      A rule, this module's triple, a rule, then whatever else is contributed. The region draws both
      separators itself: a rule inside a contributed fragment is either missing or doubled depending on
      what else is installed, and sits against that fragment's own tight gap rather than the bar's.
    */
    expect(children.map((child) => child.type)).toEqual(['we-divider', 'Row', 'we-divider', '$slot']);
    expect(walk(children[1]).some((node) => props(node).name === 'users')).toBe(true);
    expect(props(children[3]).anchor).toBe('call-dev');
  });

  it('draws no rule inside the triple, and hangs its tooltip on the glyph', () => {
    const group = walk(row()).find(
      (node) =>
        node.type === 'Row' &&
        ((node.children ?? []) as SchemaNode[]).some(
          (child) => child?.type === '$slot' && props(child).anchor === 'call-dev',
        ),
    ) as SchemaNode;
    const triple = ((group.children ?? []) as SchemaNode[])[1];

    // The separators belong to the region, so the triple carries none of its own.
    expect(walk(triple).filter((node) => node.type === 'we-divider')).toEqual([]);

    /*
      The tooltip explaining what this counts sits on the icon, not on the number.

      The icon is the only part that says which of the two triples this is, so it is what a pointer
      looking for an explanation lands on. The number is the part somebody is reading, and a tooltip
      over it covers the value it is explaining.
    */
    const glyph = walk(triple).find((node) => props(node).name === 'users') as SchemaNode;
    const holder = lineage(triple, glyph)?.find((step) => step.type === 'we-tooltip');
    expect(props(holder).content).toBe('Fake participants — development only');

    const number = walk(triple).find((node) => node.type === 'we-number') as SchemaNode;
    expect(lineage(triple, number)?.some((step) => step.type === 'we-tooltip')).toBe(false);
  });

  it('declares the development region only in a build that has one', () => {
    /*
      Vitest is a development build, so the region is declared here. The assertion worth making is the
      pairing: whatever draws the slot must declare the anchor, or a contribution to it is refused at
      registration and disappears with no error anywhere — which is the failure mode that cost a day
      when `view` was missing from the host's kernels.
    */
    const drawn = walk(chrome()).some((node) => node.type === '$slot' && props(node).anchor === 'call-dev');
    expect(callModule.contributes?.anchors ?? []).toContain('call-dev');
    expect(drawn).toBe(true);
  });

  it('declares the menu region it draws', () => {
    // The same pairing as the dev region above: a slot drawn for an anchor the module never
    // declared is a contribution point that refuses every contribution at registration.
    const drawn = walk(chrome()).some((node) => node.type === '$slot' && props(node).anchor === 'call-menu');
    expect(callModule.contributes?.anchors ?? []).toContain('call-menu');
    expect(drawn).toBe(true);
  });
});

/**
 * The way back into a call somebody is reading.
 *
 * Published as a part rather than drawn by a panel, and the reason is a category error that showed
 * up as an asymmetry: it lived in the transcript panel's header, while two panels sit side by side
 * about the same call and only one of them offered the way into it. Picking a call back up is about
 * the call, so it belongs against the call's name, and it survives both panels being closed.
 *
 * These are the three rules that came with it from the panel. They are asserted here now because
 * this is where the node is, and the panel's own suite asserts the button has not grown back there.
 */
describe('picking a call back up', () => {
  const button = () => part('continueCallButton');
  const json = () => JSON.stringify(button());

  it('is published for an interface to place', () => {
    // A template cannot be reached into: the pill that draws a call's name is the Workshop shell's
    // own chrome and has no anchor. A named part is how a module offers chrome somebody else places.
    expect(button()).toBeDefined();
  });

  it('refuses a pick-up that would tear down a call in progress, rather than hiding', () => {
    /*
      The call store's own rule, not a preference: continuing while another call runs re-points every
      peer's transcript at the old record, since peers adopt an announced record over their own.
      `goToCall` refuses for the same reason, so these cannot differ.

      Disabled with a reason rather than absent. The gate used to include `!active`, which made this
      the only thing on the pill that came and went — and it went at the moment the pill had most to
      say, since a live call can be shown with no `?call=` at all.
    */
    expect(json()).toContain('"disabled":{"$":"modules.call.active && !(');
    expect(json()).toContain("'Leave your current call to pick this one up'");
    expect(json()).not.toContain('modules.call.canCall && !modules.call.active');
  });

  it('stays put while a call runs, and follows the call on screen', () => {
    /*
      The address alone was the bug: `?call=` is how somebody opens a meeting that has *finished*, so
      a surface showing a live call usually has none, and reading it alone blanked the control for
      the whole of every call. The fallback is the one every other surface about a call uses.
    */
    expect(json()).toContain('routeStore.params.call ? routeStore.params.call : modules.call.callRecordId');
  });

  it('marks the call you are in red, the way the calls list marks its live row', () => {
    /*
      The fill role rather than the foreground one, for the reason the list gives: a live-call marker
      is a signal rather than a sentence, and the derived foreground goes pale in a dark theme.

      Against the record rather than `active`, which is true of any call — with one call running and
      another being read, `active` says yes about the wrong one.
    */
    expect(json()).toContain('modules.call.callRecordId && modules.call.callRecordId ==');
    expect(json()).toContain("? 'danger' : ''");
    expect(json()).toContain("'Go to the call'");
  });

  it('says join rather than pick up where somebody is already in the call', () => {
    // The press is identical either way — `continueCall` derives the call from its record, so
    // arriving at one somebody is in *is* joining them. The word is the only thing that differs.
    expect(json()).toContain('modules.call.liveCalls.exists(c, c.recordId ==');
    expect(json()).toContain("'Join this call'");
  });

  it('names itself for a screen reader, having no visible word to do it', () => {
    // Icon-only, so the accessible name has to be said rather than inherited from a label. The same
    // expression as the tooltip, so the two cannot drift into describing different acts.
    const pressed = walk(button()).find((node) => node.type === 'we-button');
    const label = (pressed?.props as { label?: { $?: string } } | undefined)?.label?.$;
    const tooltip = walk(button()).find((node) => node.type === 'we-tooltip');
    expect(label).toBeDefined();
    expect(label).toBe((tooltip?.props as { content?: { $?: string } } | undefined)?.content?.$);
  });

  it('branches when it is pressed rather than when it paints', () => {
    /*
      A handler array resolves lazily, so the press reads the store as it is then — which is the
      whole point of a button that survives a call starting and ending underneath it. Choosing at
      render time would bake in whichever state the pill first drew in.
    */
    const onClick = (walk(button()).find((n) => n.type === 'we-button')?.props as { onClick?: unknown })?.onClick;
    expect(Array.isArray(onClick)).toBe(true);
    expect(JSON.stringify(onClick)).toContain('modules.call.goToCall');
    expect(JSON.stringify(onClick)).toContain('modules.call.continueCall');
  });
});

/**
 * The declaration — what the manifest asks for and what the contributions name.
 *
 * These pin the places things moved to when the contract split one flat interface into a manifest,
 * a set of contributions and a store. Each is a string the host reads, so a rename here fails
 * silently at runtime as a launcher that does nothing or a panel that never opens; asserting them
 * turns that into a test failure.
 */
describe('the declaration', () => {
  const contributes = callModule.contributes!;

  it('asks for exactly the kernels the store reaches', () => {
    // A kernel not named here is absent from `deps.kernels`, so this list is the store's reach.
    expect([...(callModule.manifest.requires?.kernels ?? [])].sort()).toEqual(
      ['call', 'ephemeral', 'media', 'peerConnection', 'presence', 'records'].sort(),
    );
  });

  it('declares the devices it opens, and derives the rest of what a person agrees to', () => {
    // The three permissions are authored — they are the reason to think twice about a call module
    // from a stranger. The dock and the slot used to be authored beside them and could go stale.
    expect(callModule.manifest.requires?.permissions).toEqual(['microphone', 'camera', 'screen-share']);
    const capabilities = moduleCapabilities(callModule);
    expect(capabilities).toEqual(
      expect.arrayContaining(['microphone', 'camera', 'screen-share', 'dock', 'slot:dock-bottom']),
    );
  });

  it('owns whether its stage is up, and so declares how to close it', () => {
    // A panel naming `open` must name `close`, or the titlebar cannot dismiss it. No `icon`: the
    // rail entry is the launcher, whose press does more than open a panel.
    const stage = contributes.panels?.find((panel) => panel.name === 'stage');
    expect(stage).toMatchObject({ bid: 'stageBid', open: 'stageOpen', show: 'openStage', close: 'closeStage' });
    expect(stage?.icon).toBeUndefined();
  });

  it('declares the re-ask, so the host can bring an open-but-hidden stage forward', () => {
    /*
      `open` is a flag and `goToCall` sets it — but a stage already open is no change to observe,
      and a folded, stowed or tab-behind one needs to come forward, not to be set to true again.
      `reveal` names the store counter the call bumps on every way back: the event the host's
      `revealDock` answers, alongside `open` which the flag answers.
    */
    const stage = contributes.panels?.find((panel) => panel.name === 'stage');
    expect(stage?.reveal).toBe('stageReveal');
  });

  it('keeps its chrome up while a call runs, by a bare store key', () => {
    // `holds` and `reserve` are keys into the store, not template paths — the one field that was
    // spelt `modules.call.active` now reads like every other.
    expect(contributes.holds).toBe('active');
    // No `reserve` any more: the bar floats over nothing now that it lives inside the stage.
    expect(contributes.reserve).toBeUndefined();
    expect(contributes.holds).not.toContain('.');
  });

  it('has one launcher, and it goes to the call', () => {
    expect(contributes.launchers).toHaveLength(1);
    expect(contributes.launchers?.[0]).toMatchObject({
      action: 'goToCall',
      activeWhen: 'active',
      availableWhen: 'canCall',
    });
  });

  it('makes the button a template places a "go to" too, so it joins rather than forks a call', () => {
    // `startCallButton`'s own description has always promised "goes to the one running" — the
    // action is what lagged. A header wired to it must not mint a second call while presence
    // already shows one.
    const json = JSON.stringify(part('startCallButton'));
    expect(json).toContain('modules.call.goToCall');
    expect(json).not.toContain('modules.call.startCall');
  });

  it('declares the activity the transcriber reads off its roster', () => {
    // `record` and `continued` were the two fields another module read by convention.
    expect(contributes.activities?.call).toMatchObject({ record: 'string', continued: 'boolean', anchor: 'object' });
  });

  it('is what the package factory hands a host', () => {
    expect(createModule({ components: {} })).toBe(callModule);
  });
});

/**
 * The device chooser, and the two places it is reached from.
 *
 * One fragment placed twice — the call bar's More menu, for somebody who cannot be heard right now,
 * and the settings screen, for somebody choosing before they join. Those are genuinely different
 * moments and the same control serves both; what must not happen is two controls that drift.
 */
describe('choosing a camera and microphone', () => {
  it('is offered from the call bar, without folding at any width', () => {
    /*
      In the menu rather than beside the mute button, which the bar's own note explains: mute and
      camera never fold because "a menu between a person and their microphone is a step too many".
      Choosing a device is not that — it is done once and then forgotten.
    */
    const menu = walk(chrome()).find((node) => node.type === 'we-menu') as SchemaNode;
    const entry = walk(menu).find(
      (node) =>
        node.type === 'we-menu-item' &&
        JSON.stringify(props(node).onSelect) === JSON.stringify({ $invoke: 'modules.call.openDeviceSettings' }),
    );

    expect(entry, 'the bar offers no way to change device').toBeDefined();
  });

  it('is published as a part, so a settings screen places the same one', () => {
    // A part rather than a second copy: the settings page draws `call.deviceSettings` inline, and
    // the sheet draws it inside a modal. Two pickers that could disagree is the failure this avoids.
    const picker = part('deviceSettings');
    expect(picker, 'nothing is published for a settings screen to place').toBeDefined();
    expect(JSON.stringify(picker)).toContain('modules.call.setDevice');
  });

  it('draws its sheet as chrome, above the bar that opens it', () => {
    // Chrome rather than a panel, for the audio sink's reason: it is opened from the bar and from a
    // settings overlay, and neither can own a dialog the other also opens.
    const sheet = (callModule.contributes?.slots ?? []).find((slot) =>
      JSON.stringify(slot.node).includes('modules.call.deviceSettingsOpen'),
    );
    expect(sheet, 'the chooser has nowhere to render').toBeDefined();
    expect(sheet?.anchor).toBe('overlay');
  });
});

/**
 * A chooser with nothing in it has two meanings, and only one of them is about hardware.
 *
 * The settings page said "No microphone found on this computer" on a machine with a working
 * microphone plugged into it. Two causes, and both were ours: nothing asked the host what devices
 * existed unless a call was joined or the call bar's sheet was opened, and the empty branch asserted
 * a fact about the hardware from a list a browser had never been permitted to fill in.
 */
describe('a device list that is empty', () => {
  const picker = () => JSON.stringify(part('deviceSettings'));

  it('does not claim there is no hardware until the machine has been asked', () => {
    /*
      A browser lists no devices, and no names, until a capture has been allowed — so that a page
      cannot fingerprint a machine by its hardware without asking. Before that, "none found" is a
      claim made from a list that was never allowed to mention any.
    */
    const json = picker();
    const claim = json.indexOf('No microphone found');
    expect(claim, 'the picker no longer says anything about an empty list').toBeGreaterThan(-1);
    expect(json, 'the claim is made unconditionally').toContain('modules.call.devicesProbed');

    // The assertion sits inside a gate on having probed, not beside it.
    const gate = json.lastIndexOf('modules.call.devicesProbed', claim);
    expect(gate, 'the "none found" sentence is not behind a probe check').toBeGreaterThan(-1);
  });

  it('offers the way forward while there is one, and not after', () => {
    /*
      Two states reach it — devices listed but anonymous, or nothing listed at all — and both are the
      same refusal seen from stricter and looser browsers. Both are fixed by asking once, and neither
      is worth a button once the machine has been asked.
    */
    const json = picker();
    expect(json).toContain('modules.call.nameDevices');
    expect(json, 'the offer outlives the thing it fixes').toContain('!modules.call.devicesProbed');
  });
});

/**
 * Props the design system does not read, in the one file three checks cannot see.
 *
 * `validate:schemas` walks `*.schema.ts`; `tooltip-audit` and `role-audit`'s schema half walk
 * top-level *exported* nodes. This module's chrome is neither — it is module-level consts composed
 * into `contributes` at definition time, in a file called `index.ts`. So a prop spelled in a way
 * nothing reads renders nothing, reports nothing, and is found by somebody noticing the screen.
 *
 * Both cases below were real, and shipped together: four `we-tooltip`s carrying `title` (which is a
 * global HTML attribute, so the browser drew its own bubble instead), and two icons coloured
 * `var(--we-color-text-secondary)`, a token that has never existed — so the declaration was dropped
 * and the glyph inherited. Structural rather than visual, because the failure is structural: every
 * node rendered exactly as written.
 *
 * Asserted over everything the module contributes rather than over the nodes by name, so a control
 * added later is covered without anybody remembering to add it here.
 */
describe('props the design system reads', () => {
  const everything = (): SchemaNode[] => [
    ...walk(callModule.contributes?.slots ?? []),
    ...walk(callModule.contributes?.parts ?? {}),
    ...walk(callModule.contributes?.panels ?? []),
  ];

  it('asks we-tooltip for `content`, never `title`', () => {
    const asking = everything().filter(
      (node) => node.type === 'we-tooltip' && (node.props as Record<string, unknown>)?.title !== undefined,
    );
    expect(asking.map((node) => (node.props as Record<string, unknown>).title)).toEqual([]);
  });

  it('names a colour role, never a raw colour variable', () => {
    const raw: string[] = [];
    for (const node of everything()) {
      for (const [prop, value] of Object.entries((node.props ?? {}) as Record<string, unknown>)) {
        if (typeof value === 'string' && value.includes('var(--we-color-'))
          raw.push(`<${node.type}> ${prop}="${value}"`);
      }
    }
    expect(raw).toEqual([]);
  });
});

/**
 * Naming a call: the pencil and its dialog, published so every interface that draws a call's name
 * renames it the same way. The workshop's title pill wrote its own, and a Coasys call page needed one.
 */
describe('naming a call', () => {
  const json = () => JSON.stringify(part('renameCallButton'));

  it('is about the call on screen, and says so for a placer to substitute', () => {
    const subject = 'routeStore.params.call ? routeStore.params.call : modules.call.callRecordId';
    expect((callModule.contributes?.parts?.renameCallButton as ModulePart).subject).toBe(subject);
    // Every place the call is named is the whole subject token, so a placer's subject replaces them all.
    expect(json().split(`{"$":"${subject}"}`).length - 1).toBe(3);
  });

  it("writes the call's title and description to its record", () => {
    expect(json()).toContain('"$invoke":"record.update"');
    expect(json()).toContain('"title":{"$":"local.titleDraft"}');
    expect(json()).toContain('"description":{"$":"local.descriptionDraft"}');
  });

  it('seeds the drafts from the record when opened, not at mount', () => {
    // A local's `initial` is read once, before the record's query has answered.
    expect(json()).toContain('{"$setLocal":"titleDraft","value":{"$":"first(local.namedCall).title ?? \'\'"}}');
  });

  it('names itself for a screen reader', () => {
    expect(json()).toContain('"label":"Name this call"');
  });
});
