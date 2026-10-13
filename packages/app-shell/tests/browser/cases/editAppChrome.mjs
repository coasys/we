/**
 * The app's own pieces are reachable once it is gone into — WE's sidebar included.
 *
 * The sidebar is a host part whose frame has no box, inside a Column sized to nothing, holding a fixed
 * column at the chrome's layer — and the app's surface has no box either. Each of those broke a ring:
 * the hover measured the empty Column and drew nothing, and the selected ring asked whether the app's
 * surface was under the sidebar, which a surface with no box never is.
 */
export const name = 'the app’s sidebar is reachable once the app is gone into';
export const scenario = 'security:self-firing-events';
export const widths = [320];

export async function check({ call, clickAt, moveTo, count, recorded }) {
  const problems = [];
  await call('editorProbe');
  try {
    await call('editorProbeEnterApp');
    await moveTo('#probe-n-sidebar-item');
    if (!(await count('[data-we-ring="hover"]'))) problems.push('hovering the sidebar draws no ring');
    await clickAt('#probe-n-sidebar-item');
    if ((await recorded('__probeSelected')).at(-1) !== 'n-sidebar')
      problems.push(`a press on the sidebar did not select it (${(await recorded('__probeSelected')).at(-1)})`);
    if (!(await count('[data-we-ring="selected"]'))) problems.push('the selected sidebar draws no ring');
    return problems;
  } finally {
    await call('editorProbeDispose');
  }
}
