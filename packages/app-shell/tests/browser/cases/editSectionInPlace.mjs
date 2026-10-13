/**
 * A section this agent may change is edited where its shell draws it.
 *
 * The first press selects the section whole; a second press inside it — or one with the modifier —
 * goes in, edits the section's own template and selects the node under the pointer. Escape at the
 * section's top, or a press outside it, comes back out to the template on screen. While in it, nothing
 * outside it lights up, and the press that comes back out selects nothing there.
 */
export const name = 'a section is edited where its shell draws it';
export const scenario = 'security:self-firing-events';
export const widths = [320];

export async function check({ call, clickAt, moveTo, key, count, recorded }) {
  await call('editorProbe');
  try {
    const problems = [];
    const last = async (bag) => (await recorded(bag)).at(-1);

    await clickAt('#probe-n-view-inner');
    if ((await last('__probeOwner')) !== 'view:about') problems.push('the first press did not select the section');
    if (await last('__probeTarget')) problems.push('the first press already went into the section');

    await clickAt('#probe-n-view-inner');
    if ((await last('__probeTarget')) !== 'section:about') problems.push('a second press did not go into the section');
    if ((await last('__probeSelected')) !== 'n-view-inner')
      problems.push(`going in selected ${await last('__probeSelected')}, not the node pressed`);

    await key('Escape');
    if ((await last('__probeTarget')) !== 'screen') problems.push('Escape at the section’s top did not come back out');
    if ((await last('__probeOwner')) !== 'view:about')
      problems.push('coming back out did not select the section whole');

    await clickAt('#probe-n-content');
    await clickAt('#probe-n-view-inner', { hold: 'Control' });
    if ((await last('__probeTarget')) !== 'section:about')
      problems.push('the modifier did not reach straight into the section');

    // While in it, nothing outside it lights up, and a press there only comes back out.
    await moveTo('#probe-n-content');
    if (await count('[data-we-ring="hover"]')) problems.push('the page lit up while a section was being edited');
    await clickAt('#probe-n-content');
    if ((await last('__probeTarget')) !== 'screen') problems.push('a press outside the section did not come back out');
    if ((await last('__probeSelected')) !== null)
      problems.push(`a press outside the section selected ${await last('__probeSelected')} on the way out`);
    return problems;
  } finally {
    await call('editorProbeDispose');
  }
}
