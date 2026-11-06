/**
 * A toast that carries somebody's words says whose they are first, and offers its action as a button.
 *
 * - The sender's line (avatar and name) sits above the message, not beside or under it.
 * - The toast's icon is the one it names (a robot for a bot's message), not its tone's.
 * - The action is a button, drawn as one: bold text alone read as part of the message.
 */
export const name = 'a toast from somebody';
export const scenario = 'blank';
export const widths = [1200];

export async function check({ evaluate, screenshot }) {
  const out = await evaluate(async () => {
    window.__harness.toastProbe('The venue is booked for Friday.', 'Open', {
      icon: 'robot',
      from: { name: 'Data', hash: 'did:data' },
    });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    // This case's toast: a toast an earlier case raised may still be leaving.
    const toast = [...document.querySelectorAll('.we-toast')].find((t) => t.textContent.includes('booked'));
    const from = toast?.querySelector('.we-toast__from');
    const message = toast?.querySelector('.we-toast__message');
    const action = toast?.querySelector('.we-toast__action');
    const icon = toast?.querySelector(':scope > we-icon');
    return {
      from: from?.textContent?.trim(),
      avatar: !!from?.querySelector('we-avatar'),
      fromBottom: from?.getBoundingClientRect().bottom,
      messageTop: message?.getBoundingClientRect().top,
      icon: icon?.getAttribute('name') ?? icon?.name,
      action: action?.tagName.toLowerCase(),
    };
  });
  await screenshot?.('toast-sender');
  const problems = [];
  if (out.from !== 'Data' || !out.avatar) problems.push(`the sender line reads "${out.from}", avatar ${out.avatar}`);
  else if (out.fromBottom > out.messageTop + 1) problems.push('the sender is not above the message');
  if (out.icon !== 'robot') problems.push(`the toast's icon is "${out.icon}", not the one it named`);
  if (out.action !== 'we-button') problems.push(`the action is a plain <${out.action}>, not a we-button`);
  return problems;
}
