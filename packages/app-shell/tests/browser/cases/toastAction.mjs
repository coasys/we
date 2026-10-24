/**
 * A toast's action sits under its message, not beside it.
 *
 * Beside it, a label longer than "Undo" ("Use the space's theme") took the width the message needed
 * and squeezed the message into a narrow column at the left of the toast.
 */
export const name = 'toast action under the message';
export const scenario = 'blank';
export const widths = [1200];

export async function check({ evaluate, screenshot }) {
  const out = await evaluate(async () => {
    window.__harness.toastProbe(
      "Saved. You won't see it here while you're using your own theme for this space.",
      "Use the space's theme",
    );
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const box = (sel) => document.querySelector(sel)?.getBoundingClientRect();
    const toast = box('.we-toast');
    const message = box('.we-toast__message');
    const action = box('.we-toast__action');
    if (!toast || !message || !action) return { missing: true };
    return { toast: toast.width, message: message.width, messageBottom: message.bottom, actionTop: action.top };
  });
  await screenshot?.('toast');
  if (out.missing) return ['the toast, its message or its action did not render'];
  const problems = [];
  if (out.actionTop < out.messageBottom - 1)
    problems.push(`the action starts at ${out.actionTop}px, beside the message (which ends at ${out.messageBottom}px)`);
  if (out.message < out.toast * 0.6)
    problems.push(`the message is ${Math.round(out.message)}px wide in a ${Math.round(out.toast)}px toast`);
  return problems;
}
