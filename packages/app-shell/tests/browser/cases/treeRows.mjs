/**
 * A tree's rows stack: each on a line of its own, and a row's children under it.
 *
 * Measured here because the failure is pure layout and every other test is blind to it. A
 * `DesignSystemElement` host is a flex row unless the element says otherwise, so a tree whose hosts
 * kept the default drew its groups side by side on one line — "Channels Calls People" — and put an
 * open group's rows beside it rather than under it. Its jsdom tests passed throughout: they read
 * roles, focus and events, and jsdom lays nothing out.
 */
export const name = 'a tree stacks its rows';
export const scenario = 'tree:rows';
export const widths = [420];

const label = (t) => `we-tree-item:has(> we-text:text-is("${t}"))`;

export async function check({ measureText, note }) {
  const problems = [];
  const at = {};
  for (const t of ['Channels', 'General', 'Design', 'Calls', 'People']) {
    at[t] = await measureText(t, 'we-text');
    if (!at[t]) problems.push(`"${t}" is not on the page`);
  }
  if (problems.length) return problems;
  note(
    Object.entries(at)
      .map(([t, b]) => `${t} y=${b.y} x=${b.x}`)
      .join(', '),
  );

  const order = ['Channels', 'General', 'Design', 'Calls', 'People'];
  for (let i = 1; i < order.length; i++) {
    const [above, below] = [at[order[i - 1]], at[order[i]]];
    if (below.y < above.y + above.h - 1)
      problems.push(`"${order[i]}" is not below "${order[i - 1]}" — they share a line`);
  }
  if (at.Calls.x !== at.Channels.x || at.People.x !== at.Channels.x)
    problems.push('the top-level groups do not start at the same x');
  /*
    A group's rows sit one step in from it — a caret's slot and its gap, 24px — and line up with each
    other. They used to line up under the group's own label, which with a glyph put a child in the
    same column as the next top-level row, and an open group's rows could not be told from the group
    after it.
  */
  if (at.General.x !== at.Design.x) problems.push('a group’s rows do not line up with each other');
  if (at.General.x - at.Channels.x !== 24)
    problems.push(`a group’s rows sit ${at.General.x - at.Channels.x}px in from it, not one 24px step`);
  return problems;
}
