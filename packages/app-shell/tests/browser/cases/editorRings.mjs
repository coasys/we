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

export async function check({ call, clickAt, moveTo, keyDown, keyUp, key, count, measure, prop, recorded }) {
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
    if (!(await count('[data-we-ring="selected"]:has-text("press inside to reach its pieces")')))
      problems.push('a selected part’s ring does not say how to go further');
    // A small thing's name hangs above it, where it covers nothing.
    const part = await measure('[data-we-ring="selected"]');
    const chip = await measure('[data-we-ring="selected"] [data-we-ring-chip]');
    if (!chip || chip.y + chip.h > part.y + 1)
      problems.push(`a selected part’s name sits over it (${chip?.y}+${chip?.h} against ${part?.y})`);

    // Holding the modifier reaches past the part from outside it, on the key alone and then the press.
    await clickAt('#probe-n-content');
    await moveTo('#probe-n-part-inner');
    await keyDown('Control');
    if (!(await count('[data-we-ring="hover"]:has-text("in Tile")')))
      problems.push('holding the modifier over a part does not reach the piece under the pointer');
    await keyUp('Control');
    if (!(await count('[data-we-ring="hover"]:has-text("from Calls")')))
      problems.push('letting the modifier go does not come back to the part');
    await clickAt('#probe-n-part-inner', { hold: 'Control' });
    if ((await recorded('__probeOwner')).at(-1) !== 'part-node:n-part-inner')
      problems.push('a press with the modifier held does not select the piece inside the part');

    // Escape is the way back up: from the piece to the part, and from the part out.
    await key('Escape');
    if ((await recorded('__probeSelected')).at(-1) !== 'n-part')
      problems.push('Escape from a piece inside a part did not select the part');
    await key('Escape');
    if ((await recorded('__probeSelected')).at(-1) !== null)
      problems.push('Escape from a part placed at the top of the template did not leave it');

    // And past a list's first step: the row, not the list.
    await clickAt('#probe-n-content');
    await clickAt('#probe-n-row');
    if ((await recorded('__probeSelected')).at(-1) !== 'n-list')
      problems.push('a press on a row did not select its list');
    await clickAt('#probe-n-content');
    await clickAt('#probe-n-row', { hold: 'Control' });
    if ((await recorded('__probeSelected')).at(-1) !== 'n-row')
      problems.push('a press on a row with the modifier held did not select the row');
    await key('Escape');
    if ((await recorded('__probeSelected')).at(-1) !== 'n-list')
      problems.push('Escape from a row did not select its list');

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
      // Its top runs on out of sight, so the room above is the panel's: the name goes inside.
      if (
        !(await count('[data-we-ring="selected"] [data-we-ring-chip="inside"]')) &&
        (await count('[data-we-ring="selected"] [data-we-ring-chip]'))
      )
        problems.push('a ring whose top is out of sight hangs its name over what is above the scroller');
      const clipped = await prop('[data-we-ring="selected"]', 'dataset');
      if (clipped?.weRingClipped !== 'top')
        problems.push(`the ring marks ${JSON.stringify(clipped?.weRingClipped)} as running out of sight, not the top`);
    }
    return problems;
  } finally {
    await call('editorProbeDispose');
  }
}
