/**
 * Where a dragged panel lands — every kind of place a drop can put it, by a real drag through the
 * mouse: a new lane on an edge, a seat in a lane, a tab in a seat, a place in a template's lane, a
 * snap, and a tab torn out into the open. Each case presses the panel's grip, moves to a target the
 * shell offers (read while the drag is held), lets go, and measures where the panel ended up.
 */
export const name = 'where a dragged panel lands';
export const scenario = 'security:self-firing-events';
export const widths = [1280];

const NEAR = 4;
const near = (a, b) => Math.abs(a - b) <= NEAR;

export async function check({ call, press, pointTo, release }) {
  const problems = [];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 450));
  const boxes = () => call('dockProbeBoxes');
  const grip = (id) => `[data-we-panel-grip="probe:${id}"]`;

  /*
    Press `id`'s grip, move off it so the drag starts, then to the slot `pick` chooses from what is
    offered, and let go. Returns what was offered, for a problem to quote.
  */
  const dragTo = async (selector, pick, nudge = { x: 600, y: 360 }) => {
    await press(selector);
    await pointTo(nudge.x, nudge.y);
    const offered = await call('dockProbeTargets');
    const target = pick(offered);
    if (target) await pointTo(target.x, target.y);
    await release();
    return { offered, target };
  };

  const run = async (label, panels, act) => {
    await call('dockProbe', panels);
    try {
      await settle();
      const out = await act();
      for (const problem of out) problems.push(`${label}: ${problem}`);
    } catch (error) {
      problems.push(`${label}: ${String(error.message).split('\n')[0]}`);
    } finally {
      await call('editorProbeDispose');
    }
  };

  const slotOf = (mode, edge) => (offered) => offered.slots.find((slot) => slot.mode === mode && slot.edge === edge);
  const summary = (offered) => offered.slots.map((slot) => slot.key).join(' ');

  await run('a card onto an edge, as a lane of its own', [{ id: 'c', snap: 'bottom-right', width: 300 }], async () => {
    const { offered, target } = await dragTo(
      grip('c'),
      (o) => o.slots.find((slot) => slot.mode === 'band' && slot.edge === 'right'),
      { x: 1240, y: 360 },
    );
    if (!target) return [`no new lane offered on the right: ${summary(offered)}`];
    await settle();
    const { c, $space, $window } = await boxes();
    const out = [];
    if (!near(c.right, $window.right)) out.push(`not against the edge: ${c.right}`);
    if (!near($space.right, c.left)) out.push(`the space is not beside it: ${$space.right} vs ${c.left}`);
    return out;
  });

  await run(
    'a card into a lane, between two panels',
    [
      { id: 'a', snap: 'right', displace: true, band: 0, order: 0, width: 320 },
      { id: 'b', snap: 'right', displace: true, band: 0, order: 1, width: 320 },
      { id: 'c', snap: 'bottom-left', width: 260 },
    ],
    async () => {
      // Where the boundary between the two is drawn — the seam offered must be exactly there.
      const drawn = await boxes();
      const { offered, target } = await dragTo(
        grip('c'),
        (o) => o.slots.find((slot) => slot.mode === 'lane' && slot.edge === 'right' && slot.key.endsWith(':1')),
        { x: 1100, y: 360 },
      );
      if (!target) return [`no seat offered between the two: ${summary(offered)}`];
      if (!near(target.y, drawn.a.bottom))
        return [`the seam offered is not on the boundary drawn: ${target.y} vs ${drawn.a.bottom}`];
      await settle();
      const { a, b, c } = await boxes();
      const out = [];
      if (!near(c.left, a.left) || !near(c.right, a.right)) out.push(`not in the lane: ${JSON.stringify({ a, c })}`);
      if (!(a.top < c.top && c.top < b.top)) out.push(`not between them: ${a.top}, ${c.top}, ${b.top}`);
      return out;
    },
  );

  await run(
    'a card onto a seat, as a tab',
    [
      { id: 'a', snap: 'right', displace: true, band: 0, order: 0, width: 320 },
      { id: 'c', snap: 'bottom-left', width: 260 },
    ],
    async () => {
      const { offered, target } = await dragTo(grip('c'), slotOf('tab', 'right'), { x: 1100, y: 200 });
      if (!target) return [`no seat offered to stack on: ${summary(offered)}`];
      await settle();
      const { a, c } = await boxes();
      const showing = [a, c].filter((box) => box?.visible);
      return showing.length === 1 ? [] : [`${showing.length} of the seat showing, not one`];
    },
  );

  await run('a card to a snap', [{ id: 'c', snap: 'bottom-right', width: 300 }], async () => {
    const { offered, target } = await dragTo(
      grip('c'),
      (o) => {
        const snap = o.snaps.find((s) => s.id === 'top-left');
        return snap && { x: snap.left + snap.width / 2, y: snap.top + snap.height / 2 };
      },
      { x: 400, y: 300 },
    );
    if (!target) return [`no top-left snap offered: ${offered.snaps.map((s) => s.id).join(' ')}`];
    await settle();
    const { c, $space } = await boxes();
    return c.left < $space.left + 120 && c.top < 120 ? [] : [`not at the top left: ${JSON.stringify(c)}`];
  });

  await run(
    'a section to the top of its template lane',
    [
      { id: 'a', snap: 'left', home: true },
      { id: 'b', snap: 'left', home: true },
    ],
    async () => {
      const { offered, target } = await dragTo(
        grip('b'),
        (o) => o.slots.find((slot) => slot.mode === 'home' && slot.edge === 'probe' && slot.key.endsWith(':0')),
        { x: 150, y: 60 },
      );
      if (!target) return [`no place at the top of the lane offered: ${summary(offered)}`];
      await settle();
      const { a, b } = await boxes();
      return a?.visible && b?.visible && b.top < a.top ? [] : [`b is not above a: ${JSON.stringify({ a, b })}`];
    },
  );

  // A section broken out of its lane, dragged back in: what a template's lane takes.
  await run(
    'a section back into its template lane',
    [
      { id: 'a', snap: 'left', home: true },
      { id: 'c', snap: 'left', home: true },
    ],
    async () => {
      await call('dockProbeAct', 'breakOut', 'c');
      await settle();
      const out = (await boxes()).c;
      if (!out?.visible || out.right <= 302) return [`c did not break out: ${JSON.stringify(out)}`];
      const { offered, target } = await dragTo(
        grip('c'),
        (o) => o.slots.find((slot) => slot.mode === 'home' && slot.edge === 'probe'),
        { x: 150, y: 300 },
      );
      if (!target) return [`no place in the template lane offered: ${summary(offered)}`];
      await settle();
      const { c } = await boxes();
      return c?.visible && c.right <= 302 ? [] : [`not back in the lane: ${JSON.stringify(c)}`];
    },
  );

  // A card nothing declared for a lane is not offered one: the lane would not keep it.
  await run(
    'a card nothing declared for a template lane',
    [
      { id: 'a', snap: 'left', home: true },
      { id: 'c', snap: 'bottom-right', width: 260 },
    ],
    async () => {
      const { offered } = await dragTo(grip('c'), () => null, { x: 150, y: 300 });
      const home = offered.slots.filter((slot) => slot.mode === 'home');
      return home.length === 0 ? [] : [`offered the template lane: ${summary(offered)}`];
    },
  );

  await run(
    'a tab torn out of its seat',
    [
      { id: 'a', snap: 'right', displace: true, band: 0, order: 0, width: 320 },
      { id: 'b', snap: 'right', displace: true, band: 0, order: 0, width: 320 },
    ],
    async () => {
      // Whichever is behind: torn out by its tab, into the open middle of the window.
      const before = await boxes();
      const behind = before.a.visible ? 'b' : 'a';
      await dragTo(`[data-we-panel-tab="probe:${behind}"]`, () => ({ x: 500, y: 400 }), { x: 520, y: 380 });
      await settle();
      const after = await boxes();
      const out = [];
      if (!after.a.visible || !after.b.visible) out.push(`both should show once apart: ${JSON.stringify(after)}`);
      if (after[behind].right >= after.$window.right - 2) out.push('the torn-out tab is still on the edge');
      return out;
    },
  );

  return problems;
}
