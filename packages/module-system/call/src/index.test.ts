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
import { moduleCapabilities } from '@we/module-shared';
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

describe('the compact bar', () => {
  const ROOMY = { $: "surface.tier != 'base'" };
  const inCall = (): SchemaNode => walk(slotNodes()).find((node) => node.type === 'DropdownMenu') as SchemaNode;

  /** The `$if` gates above `target` that read the strip's tier, innermost last. */
  const tierGates = (target: SchemaNode): SchemaNode[] =>
    (lineage(slotNodes(), target) ?? []).filter(
      (node) => node.type === '$if' && JSON.stringify(props(node).condition).includes('surface.tier'),
    );

  const buttonFor = (action: string): SchemaNode =>
    walk(slotNodes()).find(
      (node) =>
        node.type === 'we-button' && JSON.stringify(props(node).onClick) === JSON.stringify({ $action: action }),
    ) as SchemaNode;

  /** The menu's lines are a prop rather than child nodes, so they are read rather than walked. */
  const entries = (): { onToggle?: { $action: string }; onAction?: { $action: string }; hidden?: unknown }[] =>
    props(inCall()).items as { onToggle?: { $action: string }; onAction?: { $action: string }; hidden?: unknown }[];

  it('folds screen share, show/hide and solo into one menu below the base tier', () => {
    const menu = inCall();
    expect(menu).toBeDefined();

    const toggles = entries().filter((entry) => entry.onToggle);
    expect(toggles.map((entry) => entry.onToggle!.$action).sort()).toEqual([
      'modules.call.toggleScreenShare',
      'modules.call.toggleSolo',
      'modules.call.toggleStage',
    ]);

    /*
      The fold is on the entries, not on the menu.

      It used to be a `whenCompact` around the whole menu, which made the menu itself a thing that
      only existed below `base` — see the next test for why that stopped being right. `hidden` says
      the same thing one level down, so each of the three is still withdrawn from the menu at exactly
      the width the row is showing it, and the invariant holds: the same three specs build both.

      Tested as "the condition mentions the tier" rather than as its exact text, because solo's also
      carries its own gate — it is offered only while something is focused — and that is a different
      question from folding.
    */
    for (const entry of toggles) {
      expect(JSON.stringify(entry.hidden), JSON.stringify(entry.onToggle)).toContain(ROOMY.$);
    }
  });

  it('keeps the menu at every width, because it holds more than the fold now', () => {
    /*
      Starting a second call mid-call had nowhere to live. The join bar offers a `+` for it, and only
      somebody *not* in a call ever sees that — so on a wide screen the control did not exist and a
      breakout meant hanging up first.

      A menu that existed only below `base` was the wrong home for it, so the menu stands at every
      width and the fold moved onto the entries. Asserted on the tier gates *above* the menu, since
      the failure being guarded against is somebody restoring the `whenCompact` wrapper and taking
      the start away from every desktop with it.
    */
    expect(tierGates(inCall())).toEqual([]);

    // By id rather than "the first entry that does something": the menu holds more than one of
    // those now, and a positional find would silently start asserting about whichever was added last.
    const start = entries().find((entry) => entry.id === 'start-another');
    /*
      `args` explicitly, and the empty string is the point: a handler with none forwards the click,
      and `startCall` takes an optional anchor id — so it would be handed a PointerEvent and the
      write refused. `''` is how the store spells "about the space rather than about a node in it".
    */
    expect(start?.onAction).toEqual({ $action: 'modules.call.startCall', args: [''] });
    // Never folded: it is the one entry the row does not show somewhere else.
    expect(start?.hidden).toBeUndefined();
  });

  it('takes the same three out of the row at that tier, so nothing is shown twice', () => {
    for (const action of ['modules.call.toggleScreenShare', 'modules.call.toggleStage', 'modules.call.toggleSolo']) {
      const button = buttonFor(action);
      expect(button, action).toBeDefined();
      expect(
        tierGates(button).map((gate) => props(gate).condition),
        `${action} is not withdrawn from the row when the menu holds it`,
      ).toEqual([ROOMY]);
    }
  });

  it('never folds mute, camera or hang-up', () => {
    // They are the call. A menu between a person and their microphone is one step too many at the
    // moment they need it.
    for (const action of ['modules.call.toggleAudio', 'modules.call.toggleVideo', 'modules.call.leave']) {
      expect(tierGates(buttonFor(action)), action).toEqual([]);
    }
  });

  it('keeps contributed controls in the row at every width', () => {
    // This module cannot fold chrome it does not know the meaning of, and a contributed square may be
    // the loudest thing in the bar precisely because it has to be seen.
    const slot = walk(slotNodes()).find(
      (node) => node.type === '$slot' && props(node).anchor === 'call-controls',
    ) as SchemaNode;
    expect(slot).toBeDefined();
    expect(tierGates(slot)).toEqual([]);
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
      say, since a live call is usually shown with no `?call=` at all.
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
      ['ephemeral', 'media', 'peerConnection', 'presence', 'records'].sort(),
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

  it('keeps its chrome up while a call runs, by a bare store key', () => {
    // `holds` and `reserve` are keys into the store, not template paths — the one field that was
    // spelt `modules.call.active` now reads like every other.
    expect(contributes.holds).toBe('active');
    expect(contributes.reserve).toBe('chromeReserve');
    for (const key of [contributes.holds, contributes.reserve]) expect(key).not.toContain('.');
  });

  it('has one launcher, and it goes to the call', () => {
    expect(contributes.launchers).toHaveLength(1);
    expect(contributes.launchers?.[0]).toMatchObject({
      action: 'goToCall',
      activeWhen: 'active',
      availableWhen: 'canCall',
    });
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

      Never hidden, unlike the two entries that fold when the row is roomy: those fold because the
      row is showing them itself, and this one has no counterpart in the row at any width.
    */
    const menu = walk(slotNodes()).find((node) => node.type === 'DropdownMenu') as SchemaNode;
    const items = props(menu).items as { id?: string; onAction?: unknown; hidden?: unknown }[];
    const entry = items.find((item) => item.id === 'devices');

    expect(entry, 'the bar offers no way to change device').toBeDefined();
    expect(entry?.onAction).toEqual({ $action: 'modules.call.openDeviceSettings' });
    expect(entry?.hidden, 'the entry folds away at some width').toBeUndefined();
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
