/**
 * Panels docked to a window's edge, pushing the space aside: lane-mates dividing a lane, lanes
 * side by side, a seat of tabs, and a lane stowed to its strip — the arrangement an edge holds,
 * measured on screen. Written against whatever draws a docked panel (`data-we-dock-frame`), so it
 * holds the arrangement still while the thing drawing it changes.
 */
export const name = 'docked lanes on an edge';
export const scenario = 'security:self-firing-events';
export const widths = [1280];

const NEAR = 3;
const near = (a, b) => Math.abs(a - b) <= NEAR;

export async function check({ call, dragBy, measure }) {
  const problems = [];
  const settle = () => new Promise((resolve) => setTimeout(resolve, 450));
  const boxes = () => call('dockProbeBoxes');
  const run = async (label, panels, act, assert) => {
    await call('dockProbe', panels);
    try {
      await settle();
      if (act) {
        await call('dockProbeAct', ...act);
        await settle();
      }
      for (const problem of assert(await boxes())) problems.push(`${label}: ${problem}`);
    } finally {
      await call('editorProbeDispose');
    }
  };

  // Two lane-mates on the right: one column, one above the other, dividing its height, the space beside it.
  await run(
    'lane-mates',
    [
      { id: 'a', snap: 'right', displace: true, band: 0, order: 0, width: 320 },
      { id: 'b', snap: 'right', displace: true, band: 0, order: 1, width: 320 },
    ],
    null,
    ({ a, b, $space, $window }) => {
      const out = [];
      if (!a?.visible || !b?.visible) return [`both lane-mates should show: ${JSON.stringify({ a, b, $space })}`];
      if (!near(a.left, b.left) || !near(a.right, b.right)) out.push(`not one column: ${JSON.stringify({ a, b })}`);
      if (!near(a.right, $window.right)) out.push(`not against the edge: ${a.right} vs ${$window.right}`);
      if (!(a.top < b.top)) out.push('not in order along the lane');
      if (!near(a.bottom, b.top)) out.push(`a gap or an overlap between them: ${a.bottom} → ${b.top}`);
      if (!near($space.right, a.left)) out.push(`the space is not beside the lane: ${$space.right} vs ${a.left}`);
      return out;
    },
  );

  // Two lanes on the right: the second inboard of the first, the space beside both.
  await run(
    'bands',
    [
      { id: 'a', snap: 'right', displace: true, band: 0, width: 300 },
      { id: 'b', snap: 'right', displace: true, band: 1, width: 260 },
    ],
    null,
    ({ a, b, $space }) => {
      const out = [];
      if (!a?.visible || !b?.visible) return ['both lanes should show'];
      if (!near(b.right, a.left)) out.push(`the second lane is not inboard of the first: ${b.right} vs ${a.left}`);
      if (!near($space.right, b.left)) out.push(`the space is not beside both: ${$space.right} vs ${b.left}`);
      return out;
    },
  );

  // Two panels with the same order share a seat: one shows, in the seat's whole box.
  await run(
    'a seat of tabs',
    [
      { id: 'a', snap: 'right', displace: true, band: 0, order: 0, width: 320 },
      { id: 'b', snap: 'right', displace: true, band: 0, order: 0, width: 320 },
    ],
    null,
    ({ a, b, $space }) => {
      const showing = [a, b].filter((box) => box?.visible);
      if (showing.length !== 1) return [`${showing.length} of the seat showing, not one`];
      const out = [];
      if (!near($space.right, showing[0].left)) out.push('the space is not beside the seat');
      return out;
    },
  );

  // A lane stowed: down to its strip, and the space takes the rest.
  await run(
    'a stowed lane',
    [{ id: 'a', snap: 'right', displace: true, band: 0, width: 320 }],
    ['toggleStowLane', 'a'],
    ({ $space, $window }) => {
      const strip = $window.right - $space.right;
      return strip > 0 && strip <= 48 ? [] : [`the space should give the strip only, gave ${strip}px`];
    },
  );

  // Two floats snapped to the right edge: stacked down it as cards with room between, over the space,
  // each keeping its own width against the edge.
  await run(
    'floats on an edge',
    [
      { id: 'a', snap: 'right', order: 0, width: 300 },
      { id: 'b', snap: 'right', order: 1, width: 240 },
    ],
    null,
    ({ a, b, $space, $window }) => {
      const out = [];
      if (!a?.visible || !b?.visible) return [`both floats should show: ${JSON.stringify({ a, b })}`];
      if (!(a.bottom < b.top)) out.push(`not stacked with room between: ${a.bottom} → ${b.top}`);
      if (!(a.right < $window.right)) out.push('a float should stand off the edge');
      if (!near($space.right, $window.right)) out.push(`a float should not push the space aside: ${$space.right}`);
      if (!near(a.right, b.right)) out.push(`not against the same edge: ${a.right} vs ${b.right}`);
      if (!near(a.right - a.left, 300) || !near(b.right - b.left, 240))
        out.push(`not each its own width: ${a.right - a.left}, ${b.right - b.left}`);
      return out;
    },
  );

  // The grip between two cards snapped to one edge moves the boundary between them.
  {
    await call('dockProbe', [
      { id: 'a', snap: 'right', order: 0, width: 300 },
      { id: 'b', snap: 'right', order: 1, width: 300 },
    ]);
    try {
      await settle();
      const before = await boxes();
      // As wide as the widest card, against their edge — not across the whole room the lane stands in.
      const line = await measure('[data-we-edge-cover] [data-we-lane-divider]');
      const widest = Math.max(before.a.right - before.a.left, before.b.right - before.b.left);
      if (!line || !near(line.w, widest) || !near(line.x + line.w, before.a.right))
        problems.push(`the grip between cards is not the cards' width: ${JSON.stringify(line)} vs ${widest}`);
      try {
        await dragBy('[data-we-edge-cover] [data-we-lane-divider]', 0, 80);
        await settle();
        const after = await boxes();
        const grew = after.a.bottom - after.a.top - (before.a.bottom - before.a.top);
        if (!near(grew, 80)) problems.push(`the grip between cards: the upper card grew ${grew}px for an 80px drag`);
      } catch (error) {
        problems.push(`the grip between cards: ${error.message.split('\n')[0]}`);
      }
    } finally {
      await call('editorProbeDispose');
    }
  }

  // Two sections sharing a template's lane: the boundary between them moves where it is dragged.
  {
    await call('dockProbe', [
      { id: 'a', snap: 'left', home: true, grow: 1 },
      { id: 'b', snap: 'left', home: true, grow: 1 },
    ]);
    try {
      await settle();
      const before = await boxes();
      if (!before.a?.visible || !before.b?.visible)
        problems.push(`the sections in a template's lane should show: ${JSON.stringify(before)}`);
      else {
        // A flush section paints nothing, so it shows what its lane is painted — whoever drew it.
        const shown = await call('paintAt', (before.a.left + before.a.right) / 2, (before.a.top + before.a.bottom) / 2);
        const lane = await call('roleColor', 'accent-soft');
        if (shown !== lane) problems.push(`a section in a painted lane shows ${shown}, not the lane's ${lane}`);
        try {
          await dragBy('#probe-lane [data-we-lane-divider]', 0, 100);
          await settle();
          const after = await boxes();
          const grew = after.a.bottom - after.a.top - (before.a.bottom - before.a.top);
          if (!near(grew, 100))
            problems.push(`the grip between sections: the upper one grew ${grew}px for a 100px drag`);
        } catch (error) {
          problems.push(`the grip between sections: ${error.message.split('\n')[0]}`);
        }
      }
    } finally {
      await call('editorProbeDispose');
    }
  }

  return problems;
}
