/**
 * A call's transcript panel, on a call that holds one heard line and one typed message.
 *
 * - The heard line is a bare `TextBlock` under the call.
 * - The typed message is a composition: a `CollectionBlock` with `kind: 'message'`, with the words in
 *   `textContent` and its own `TextBlock` under it.
 *
 * The panel must show each line once, the heard line first.
 */
export const name = 'a call transcript shows heard lines and typed messages, once each, in time order';
export const scenario = 'calls:typed-and-heard-transcript';
export const widths = [420];

export const HEARD = 'Heard on the call before anybody typed.';
export const TYPED = 'Typed into the call chat after that.';

/**
 * The checks each `typedAndHeard*` case makes: each line is drawn once, heard line above typed one,
 * and — where the surface counts its lines — the count is the number of lines.
 */
export async function checkLines({ evaluate, screenshot }, label, count) {
  const problems = [];
  const found = await evaluate(
    ([words]) =>
      words.map((text) => {
        // The innermost elements whose whole text is these words: one for each time a line is drawn.
        const hits = [...document.querySelectorAll('*')].filter((el) => (el.textContent ?? '').trim() === text);
        const inner = hits.filter((el) => !hits.some((other) => other !== el && el.contains(other)));
        return inner.map((el) => el.getBoundingClientRect().top);
      }),
    [[HEARD, TYPED]],
  );
  const [heard, typed] = found;
  if (heard.length !== 1) problems.push(`the heard line is drawn ${heard.length} times, where it was said once`);
  if (typed.length !== 1) problems.push(`the typed message is drawn ${typed.length} times, where it was sent once`);
  if (heard.length && typed.length && !(heard[0] < typed[0]))
    problems.push('the typed message is drawn above the heard line, which was said first');
  if (count) {
    // In the page's text, or in the `text` property of a `we-text`, which draws it in its shadow root.
    const counts = await evaluate(() =>
      [
        document.getElementById('mount')?.textContent ?? '',
        ...[...document.querySelectorAll('we-text')].map((t) => t.text),
      ]
        .filter((text) => typeof text === 'string' && /utterance/.test(text))
        .map((text) => text.match(/[\d+]+ utterances?/g) ?? [])
        .flat(),
    );
    if (!counts.includes(count))
      problems.push(`no "${count}" count on the call (found: ${counts.join(', ') || 'none'})`);
  }
  await screenshot?.(label);
  return problems;
}

export async function check(page) {
  return checkLines(page, 'typed-and-heard-transcript');
}
