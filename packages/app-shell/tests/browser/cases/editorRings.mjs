/**
 * A ring says what it rings, and stops where sight does.
 *
 * A placed part is the template's node and the module's contents, so its ring is named — without a
 * name a press inside it selecting the whole thing read as the editor failing to reach in. And a node
 * taller than the scroller holding it is ringed to what can be seen, its out-of-sight edge dashed,
 * rather than drawn up over whatever sits above the scroller.
 */
export const name = 'a ring names a part, and stops at its scroller';
export const scenario = 'security:self-firing-events';
export const widths = [320];

export async function check({ call, clickAt, moveTo, count, measure, prop }) {
  await call('editorProbe');
  try {
    const problems = [];

    await moveTo('#probe-n-part-inner');
    if (!(await count('[data-we-ring="hover"]:has-text("Tile"):has-text("from Calls — select it for options")')))
      problems.push('hovering a placed part does not name it');
    await clickAt('#probe-n-part-inner');
    if (!(await count('[data-we-ring="selected"]:has-text("Tile")')))
      problems.push('a selected part’s ring does not name it');
    if (await count('[data-we-ring="selected"]:has-text("select it for options")'))
      problems.push('a selected part’s ring still asks to be selected');

    const host = await measure('#probe-scroll-host');
    await moveTo('#probe-scroll-host');
    const hover = await measure('[data-we-ring="hover"]');
    if (!hover || hover.y < host.y - 1)
      problems.push(`the hover ring runs above its scroller (${hover?.y} against ${host.y})`);

    await clickAt('#probe-scroll-host');
    const ring = await measure('[data-we-ring="selected"]');
    if (!ring) problems.push('a node scrolled half out of view has no selected ring');
    else {
      if (ring.y < host.y - 1 || ring.y + ring.h > host.y + host.h + 1)
        problems.push(`the selected ring is not held to its scroller (${ring.y}+${ring.h} in ${host.y}+${host.h})`);
      const clipped = await prop('[data-we-ring="selected"]', 'dataset');
      if (clipped?.weRingClipped !== 'top')
        problems.push(`the ring marks ${JSON.stringify(clipped?.weRingClipped)} as running out of sight, not the top`);
    }
    return problems;
  } finally {
    await call('editorProbeDispose');
  }
}
