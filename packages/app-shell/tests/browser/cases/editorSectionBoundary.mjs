/**
 * A press inside a region somebody else provides selects the region, or the template's placement of
 * it — never a node inside it, which the template does not own.
 *
 * Three such regions, each with a stamped node inside that the template being edited does not
 * contain: a section the shell mounts (a built-in's nodes carry derived ids), a panel a module draws
 * itself, and a part the template placed. The outermost boundary between a press and its surface is
 * the one that answers.
 */
export const name = 'a press inside somebody else’s region selects the region';
export const scenario = 'security:self-firing-events';
export const widths = [320];

export async function check({ call, clickAt, recorded }) {
  await call('editorProbe');
  try {
    const problems = [];

    await clickAt('#probe-n-view-inner');
    let selected = await recorded('__probeSelected');
    let owner = await recorded('__probeOwner');
    if (selected.includes('n-view-inner'))
      problems.push('a press inside a section selected one of the section’s own nodes');
    if (owner.at(-1) !== 'view:about')
      problems.push(`a press inside a section selected ${owner.at(-1) ?? 'nothing'} as its owner`);

    await clickAt('#probe-n-owned-inner');
    selected = await recorded('__probeSelected');
    owner = await recorded('__probeOwner');
    if (selected.includes('n-owned-inner'))
      problems.push('a press inside a module’s panel selected a node of the module’s');
    if (owner.at(-1) !== 'panel:call:stage')
      problems.push(`a press inside a module’s panel selected ${owner.at(-1) ?? 'nothing'} as its owner`);

    await clickAt('#probe-n-part-inner');
    selected = await recorded('__probeSelected');
    if (selected.at(-1) !== 'n-part')
      problems.push(`a press inside a placed part selected ${selected.at(-1) ?? 'nothing'}`);

    const pressed = await recorded('__probePressed');
    for (const id of ['n-view-inner', 'n-owned-inner', 'n-part-inner'])
      if (pressed.includes(id)) problems.push(`${id}'s own control fired while editing`);
    return problems;
  } finally {
    await call('editorProbeDispose');
  }
}
