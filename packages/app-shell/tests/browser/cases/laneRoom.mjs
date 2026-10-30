/**
 * A template's lane can be dragged as wide as the reader likes, short of leaving the rest of its row
 * less than `LANE_LEAVES_PX` (360px) — so the view beside it stays usable, and the handle reachable.
 */
export const name = 'a lane drags as wide as its row allows, and no wider';
export const scenario = 'blank';
export const widths = [1280];

export async function check({ call, dragBy, measure }) {
  const problems = [];
  await call('laneRoomProbe');
  try {
    const width = async (sel) => {
      const box = await measure(sel);
      if (!box) throw new Error(`nothing at ${sel}`);
      return box.w;
    };
    // Past its old cap: a sidebar is not held to a fixed width.
    await dragBy('#room-row > [data-we-panel-lane]:first-child we-resize-handle', 200, 0);
    const wider = await width('#room-row > [data-we-panel-lane]:first-child');
    if (Math.abs(wider - 480) > 2) problems.push(`a lane dragged 200px wider is ${wider}px, not 480px`);

    // Far past what the row has: it stops where the view keeps 360px beside the other lane's 300px.
    await dragBy('#room-row > [data-we-panel-lane]:first-child we-resize-handle', 600, 0);
    const lane = await width('#room-row > [data-we-panel-lane]:first-child');
    const view = await width('#room-view');
    if (Math.abs(lane - 540) > 2) problems.push(`a lane dragged past its row is ${lane}px, not 540px`);
    if (view < 358) problems.push(`the view beside a lane dragged wide was left ${view}px`);
  } finally {
    await call('editorProbeDispose');
  }
  return problems;
}
