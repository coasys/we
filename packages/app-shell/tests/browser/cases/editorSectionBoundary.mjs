/**
 * A press inside a section the shell mounts is the section's, not a node of the shell's.
 *
 * A built-in section's nodes carry ids of their own — derived, so they are the same in every build —
 * and the renderer stamps them like any other. The template being edited does not contain them, so
 * resolving a press to the nearest id inside a section selected something the inspector cannot
 * find, and the panel went blank. The section boundary is further out than any of those ids, and the
 * outermost boundary between a press and its surface is the one that answers.
 */
export const name = 'a press inside a section is the section’s';
export const scenario = 'security:self-firing-events';
export const widths = [320];

export async function check({ call, clickAt, recorded }) {
  await call('editorProbe');
  try {
    const problems = [];
    await clickAt('#probe-n-view-inner');
    const selected = await recorded('__probeSelected');
    if (selected.includes('n-view-inner'))
      problems.push('a press inside a section selected one of the section’s own nodes');
    const pressed = await recorded('__probePressed');
    if (pressed.includes('n-view-inner')) problems.push('the section’s own control fired while editing');
    return problems;
  } finally {
    await call('editorProbeDispose');
  }
}
