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

export async function check({ call }) {
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

  // Two floats snapped to the right edge: stacked down it as cards with room between, over the space.
  await run(
    'floats on an edge',
    [
      { id: 'a', snap: 'right', order: 0, width: 300 },
      { id: 'b', snap: 'right', order: 1, width: 300 },
    ],
    null,
    ({ a, b, $space, $window }) => {
      const out = [];
      if (!a?.visible || !b?.visible) return [`both floats should show: ${JSON.stringify({ a, b })}`];
      if (!(a.bottom < b.top)) out.push(`not stacked with room between: ${a.bottom} → ${b.top}`);
      if (!(a.right < $window.right)) out.push('a float should stand off the edge');
      if (!near($space.right, $window.right)) out.push(`a float should not push the space aside: ${$space.right}`);
      return out;
    },
  );

  return problems;
}
