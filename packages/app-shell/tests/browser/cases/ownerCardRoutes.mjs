/**
 * Taking over a region somebody else provides writes what it says it will.
 *
 * The inspector's card offers routes out of a placed part and a module's panel, and each one names
 * its cost — "the pieces stay the module's", "it will no longer receive changes". Those are promises
 * about what lands in the template, so this checks the template: an opened part keeps the references
 * below it, a copied one keeps none, both get ids of their own and say where they came from, and
 * arranging a panel fills in the entry that already places it rather than adding a second one.
 */
export const name = 'taking over somebody else’s region writes what it says';
export const scenario = 'security:self-firing-events';
export const widths = [320];

const isNodeId = (id) => typeof id === 'string' && /^[a-z][a-z0-9]{9}$/.test(id);

export async function check({ call, count, recorded }) {
  const problems = [];

  await call('ownerCardProbe', 'part');
  try {
    if (!(await call('pressButton', 'Open'))) problems.push('the part card offers no Open for a part built of parts');
    const [opened] = (await recorded('__probeTemplates')).slice(-1);
    const node = opened?.children?.[0];
    if (node?.type !== 'Column') problems.push(`opening the part wrote ${node?.type ?? 'nothing'} in its place`);
    if (node?.children?.[0]?.type !== '$part')
      problems.push('opening the part did not keep the piece below it a reference');
    if (node?.forkedFrom !== 'part:demo.box') problems.push(`an opened part says it came from ${node?.forkedFrom}`);
    if (!isNodeId(node?.id) || node?.id === 'aaaaaaaaaa') problems.push(`an opened part has the id ${node?.id}`);
  } finally {
    await call('editorProbeDispose');
  }

  await call('ownerCardProbe', 'part');
  try {
    await call('pressButton', 'Copy');
    const [copied] = (await recorded('__probeTemplates')).slice(-1);
    const node = copied?.children?.[0];
    if (JSON.stringify(node).includes('$part')) problems.push('a copied part still holds a reference to the module');
    if (!isNodeId(node?.children?.[0]?.id)) problems.push('a copied part’s insides have no ids of their own');
  } finally {
    await call('editorProbeDispose');
  }

  // The path in its heading goes back up: the part the template placed is a step of it, not a route.
  await call('ownerCardProbe', 'part-node');
  try {
    if (await call('pressButton', 'Select')) problems.push('a node inside a part still offers going up as a route');
    if (!(await call('pressButton', 'Box'))) problems.push('a node inside a part has no path back to its part');
    const [up] = (await recorded('__probeSelected')).slice(-1);
    if (up !== 'aaaaaaaaaa') problems.push(`the path back selected ${up}, not the part the template placed`);
  } finally {
    await call('editorProbeDispose');
  }

  // A node somebody went into a part to reach: copying opens the path to it, and selects it in the copy.
  await call('ownerCardProbe', 'part-node');
  try {
    if (!(await call('pressButton', 'Copy'))) problems.push('a node inside a part offers no way to make it your own');
    const [written] = (await recorded('__probeTemplates')).slice(-1);
    const node = written?.children?.[0];
    const avatar = node?.children?.[0];
    if (node?.type !== 'Column') problems.push(`copying the path wrote ${node?.type ?? 'nothing'} in the part’s place`);
    if (node?.children?.[1]?.type !== '$part') problems.push('copying the path took the piece beside it too');
    if (avatar?.type !== 'we-avatar' || !isNodeId(avatar?.id) || avatar?.id === 'cccccccccc')
      problems.push(`the node copied has the id ${avatar?.id}`);
    if (JSON.stringify(written).includes('__weEditorPicked')) problems.push('the copy kept the editor’s marker');
    const [selected] = (await recorded('__probeSelected')).slice(-1);
    if (!avatar?.id || selected !== avatar.id)
      problems.push(`after copying, ${selected} was selected, not the node copied`);
  } finally {
    await call('editorProbeDispose');
  }

  // A copy nobody has changed goes back whole, as the placement it replaced, with nothing to lose.
  await call('ownerCardProbe', 'copied-clean');
  try {
    if (await count('we-text:has-text("Give it all back")'))
      problems.push('an unchanged copy warns about losing changes');
    if (!(await call('pressButton', 'Give back'))) problems.push('an unchanged copy offers no way back');
    const [back] = (await recorded('__probeTemplates')).slice(-1);
    const placed = back?.children?.[0];
    if (placed?.type !== '$part' || placed?.props?.id !== 'demo.feed')
      problems.push(`giving a copy back wrote ${placed?.type ?? 'nothing'} in its place`);
    if (placed?.props?.subject?.$ !== 'local.chosen')
      problems.push('giving a copy back lost what its placement was about');
  } finally {
    await call('editorProbeDispose');
  }

  // A change inside the lines keeps the feed holding them: only all of it can go back, and it says so.
  await call('ownerCardProbe', 'copied-inner');
  try {
    if (!(await count('we-text:has-text("your changes to Lines are lost")')))
      problems.push('giving back a changed copy does not say which changes are lost');
    if (await count('we-text:has-text("Give back what you have not changed")'))
      problems.push('offers to give back unchanged levels when none can go without the change');
  } finally {
    await call('editorProbeDispose');
  }

  // A change to the feed's own nodes leaves the lines untouched: they can go back alone.
  await call('ownerCardProbe', 'copied-outer');
  try {
    if (!(await count('we-text:has-text("Lines goes back to Demo")')))
      problems.push('does not offer to give back the unchanged lines below a change');
    const buttons = await count('we-button:has-text("Give back")');
    if (buttons !== 2) problems.push(`a copy changed outside its inner level offers ${buttons} ways back, not 2`);
    await call('pressGiveBackUnchanged');
    const [kept] = (await recorded('__probeTemplates')).slice(-1);
    const feed = kept?.children?.[0];
    if (!feed?.forkedPart) problems.push('giving back the unchanged levels gave back the changed one too');
    if (feed?.children?.[1]?.type !== '$part' || feed?.children?.[1]?.props?.id !== 'demo.lines')
      problems.push('the unchanged lines were not put back as their placement');
    if (feed?.children?.[0]?.children?.[0] !== 'What was said')
      problems.push('giving back the unchanged levels lost a change');
  } finally {
    await call('editorProbeDispose');
  }

  // A section opened on its own says so, and the way back to the shell it lives in is one press.
  await call('ownerCardProbe', 'section-alone');
  try {
    if (!(await count('we-text:has-text("Editing About (yours) on its own, a section of My shell")')))
      problems.push('a section on its own does not say it is one');
    if (!(await call('pressButton', 'Back to My shell'))) problems.push('a section on its own offers no way back');
    if (!(await recorded('__probeBack')).length) problems.push('the way back does not go back');
  } finally {
    await call('editorProbeDispose');
  }

  await call('ownerCardProbe', 'panel');
  try {
    // It names what stays the module's, rather than claiming everything does.
    if (!(await count('we-text:has-text("Tile stay Calls\'s")')))
      problems.push('the panel card does not name the pieces arranging keeps the module’s');
    if (!(await call('pressButton', 'Arrange'))) problems.push('the panel card offers no Arrange');
    const [arranged] = (await recorded('__probeTemplates')).slice(-1);
    const panels = arranged?.meta?.panels ?? [];
    if (panels.length !== 1) problems.push(`arranging the panel left ${panels.length} entries for it`);
    const entry = panels[0];
    if (entry?.dock !== 'stage' || entry?.node?.type !== 'Column')
      problems.push('arranging the panel did not put its composition in the entry that places it');
    if (entry?.snap !== 'right') problems.push('arranging the panel lost where the template had placed it');
    if (entry?.node?.forkedFrom !== 'panel:call:stage')
      problems.push('an arranged panel does not say where it came from');
  } finally {
    await call('editorProbeDispose');
  }

  await call('ownerCardProbe', 'palette');
  try {
    if (!(await call('pressButton', 'Add'))) problems.push('the palette offers no part to add');
    const [added] = (await recorded('__probeTemplates')).slice(-1);
    const last = added?.children?.at(-1);
    if (last?.type !== '$part' || last?.props?.id !== 'demo.box') problems.push('adding a part did not place it');
    if (!isNodeId(last?.id)) problems.push('a placed part has no id of its own');
    if (!added?.meta?.requires?.modules?.includes('demo')) problems.push('adding a part did not declare its module');
    const selected = await recorded('__probeSelected');
    if (selected.at(-1) !== last?.id) problems.push('adding a part did not select it');
  } finally {
    await call('editorProbeDispose');
  }

  /*
    A section is replaced for everyone, so the copy is asked about first and its cost is said before
    it is made. Somebody who does not run the space is told why rather than offered a dead button.
  */
  await call('ownerCardProbe', 'view');
  try {
    await call('pressButton', 'Copy');
    if ((await recorded('__probeForked')).length) problems.push('a section was copied without being asked about');
    if (!(await call('pressButton', 'Make the copy'))) problems.push('copying a section asked nothing first');
    await call('idleFrames', 2);
    if ((await recorded('__probeForked')).at(-1) !== 'about') problems.push('confirming did not copy the section');
    if (!(await call('pressButton', 'Edit it'))) problems.push('a copied section offers no way to edit it');
    if ((await recorded('__probeOpened')).at(-1) !== 'about-yours') problems.push('“Edit it” did not open the copy');
  } finally {
    await call('editorProbeDispose');
  }

  // Where the copy can be changed in place, copying goes straight into changing it.
  await call('ownerCardProbe', 'view-editable');
  try {
    await call('pressButton', 'Copy');
    await call('pressButton', 'Make the copy');
    await call('idleFrames', 2);
    if ((await recorded('__probeTarget')).at(-1) !== 'section:about-yours')
      problems.push('a copy that can be changed in place was not gone into');
  } finally {
    await call('editorProbeDispose');
  }

  await call('ownerCardProbe', 'view-blocked');
  try {
    if (await call('pressButton', 'Copy'))
      problems.push('a section can be copied by somebody who does not run the space');
  } finally {
    await call('editorProbeDispose');
  }

  /*
    The way back from arranging a panel. An entry arranging made is removed whole, which is the
    template as it was; one that also places the panel keeps its placement and loses only the contents.
  */
  await call('ownerCardProbe', 'arranged');
  try {
    if (!(await call('pressButton', 'Give it back'))) problems.push('an arranged panel offers no way back');
    const [after] = (await recorded('__probeTemplates')).slice(-1);
    if ((after?.meta?.panels ?? []).length) problems.push('giving back a panel arranging made left its entry behind');
  } finally {
    await call('editorProbeDispose');
  }

  await call('ownerCardProbe', 'arranged-placed');
  try {
    await call('pressButton', 'Give it back');
    const [after] = (await recorded('__probeTemplates')).slice(-1);
    const entry = after?.meta?.panels?.[0];
    if (entry?.snap !== 'right') problems.push('giving back a panel lost where the template placed it');
    if (entry?.node) problems.push('giving back a panel kept the template’s arrangement');
  } finally {
    await call('editorProbeDispose');
  }

  return problems;
}
