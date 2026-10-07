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

export async function check({ call, recorded }) {
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

  await call('ownerCardProbe', 'panel');
  try {
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

  return problems;
}
