/**
 * The AI chat's replies as a backend runs them: each one's tool calls as steps under it, open while
 * it runs and folded to a count after, how a reply that did not finish ended with a way to send it
 * again, and Stop in place of Send while one runs. With `WE_BROWSER_SHOTS`, photographs the panel.
 */
export const name = 'chat replies show their steps and how they ended';
export const scenario = 'blank';
export const widths = [380];

export async function check({ evaluate, screenshot }) {
  await evaluate(() => window.__harness.chatPanelProbe());
  await new Promise((r) => setTimeout(r, 300));
  await screenshot('chat-steps');
  const seen = await evaluate(() => {
    const texts = [...document.querySelectorAll('we-text')].map((t) => t.textContent.trim());
    const buttons = [...document.querySelectorAll('we-button')].map((b) => b.textContent.trim());
    const icons = [...document.querySelectorAll('we-icon')].map((i) => i.getAttribute('name') || i.name);
    return { texts, buttons, icons, spinners: document.querySelectorAll('we-animated-icon').length };
  });
  const problems = [];
  const has = (t) => seen.texts.includes(t);
  if (!has('4 steps')) problems.push('the finished reply does not fold its steps to "4 steps"');
  if (!seen.buttons.includes('Open the new template'))
    problems.push('the finished reply does not offer to open the template it made');
  if (has('Read the documentation')) problems.push('the finished reply shows its steps unfolded');
  if (!seen.texts.some((t) => t.startsWith('The reply failed: credits ran out')))
    problems.push('the failed reply does not say why');
  if (!has('Stopped when the node restarted')) problems.push('the interrupted reply does not say so');
  if (!has('Stopped')) problems.push('the stopped reply does not say so');
  if (seen.buttons.filter((b) => b === 'Send again').length !== 3)
    problems.push('"Send again" is not offered on the three unfinished replies');
  if (!has('Updating the template')) problems.push('the running reply does not say what it is doing');
  if (seen.spinners !== 1) problems.push(`${seen.spinners} spinners, where only the running step has one`);
  if (!seen.icons.includes('stop')) problems.push('no Stop while a reply runs');
  if (seen.icons.includes('paper-plane-tilt')) problems.push('Send is shown while a reply runs');

  const asked = await evaluate(() => {
    const open = [...document.querySelectorAll('we-button')].find(
      (b) => b.textContent.trim() === 'Open the new template',
    );
    open?.click();
    return window.__probeOpened;
  });
  if (asked !== 'ad4m://t/made') problems.push(`Open asked for ${asked}, not the template the reply made`);

  // Open the stopped reply's steps: the step its stop cut off says so, and does not spin.
  await evaluate(() => {
    const fold = [...document.querySelectorAll('we-button')].find((b) => b.textContent.trim() === '1 step');
    fold?.click();
  });
  await new Promise((r) => setTimeout(r, 100));
  await screenshot('chat-steps-stopped');
  const opened = await evaluate(() => ({
    texts: [...document.querySelectorAll('we-text')].map((t) => t.textContent.trim()),
    spinners: document.querySelectorAll('we-animated-icon').length,
  }));
  if (!opened.texts.includes('Updating the template (stopped)'))
    problems.push('the step a stop cut off does not say it was stopped');
  if (opened.spinners !== 1) problems.push('the step a stop cut off still spins');
  return problems;
}
