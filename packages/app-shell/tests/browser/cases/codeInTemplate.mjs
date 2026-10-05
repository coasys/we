/**
 * A template cannot run code of its own.
 *
 * Each element in the scenario is a way a schema might: a `script`, an `iframe` with `srcdoc`, a string
 * `onerror`, a `javascript:` URL written down, built by an expression, and handed to `we-link`, and an
 * `embed` of an HTML `data:` URL. Before the element allowlist the first three ran in the app's origin.
 *
 * The links are clicked, because a `javascript:` URL does nothing until it is followed. The marker at
 * the end must still be there: a string `onerror` used to throw while mounting and blank the render.
 */
export const name = 'a template cannot run code of its own';
export const scenario = 'security:code-in-template';
export const widths = [320];

const ATTEMPTS = ['script', 'srcdoc', 'onerror', 'jshref', 'jsexpr', 'welink', 'embed'];

export async function check({ count, click, note }) {
  for (const id of ['#js-link', '#js-expr', '#js-we-link']) await click(id);
  const problems = [];
  const ran = [];
  for (const n of ATTEMPTS) if (await count(`body[data-ran-${n}]`)) ran.push(n);
  if (ran.length) problems.push(`ran in the app's origin: ${ran.join(', ')}`);
  if (!(await count('#still-here'))) problems.push('the rest of the template did not render');
  note(ran.length ? `ran: ${ran.join(', ')}` : 'nothing ran; the template still drew');
  return problems;
}
