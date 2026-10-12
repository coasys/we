/**
 * Hovering a mention shows who it names: their face and their name as it is now.
 *
 * A chip carries the name as it was typed, which cannot tell two people with one name apart and is
 * wrong after a rename. The card answers from the host's profiles, so the scenario's person is known
 * by a fuller name than the chip says — a card repeating the chip would pass a test that only asked
 * whether a card appeared.
 */
export const name = 'hovering a mention shows who it names';
export const scenario = 'mention:card';
export const widths = [420];

export async function check({ hover, count, measure }) {
  const problems = [];
  if ((await count('.we-mention[data-did]')) !== 1) return ['the mention was not drawn as a chip'];
  if ((await count('.we-mention-card')) !== 0) problems.push('a card is showing before anything was hovered');

  await hover('.we-mention');
  await new Promise((resolve) => setTimeout(resolve, 500));
  const card = await measure('.we-mention-card');
  if (!card) return [...problems, 'no card after resting on the mention'];
  if (!card.text.includes('Ann Okafor')) problems.push(`the card says "${card.text}" rather than the person's name`);
  if ((await count('.we-mention-card we-avatar')) !== 1) problems.push('the card has no face');

  await hover('#elsewhere');
  await new Promise((resolve) => setTimeout(resolve, 100));
  if ((await count('.we-mention-card')) !== 0) problems.push('the card stayed after the pointer left the mention');
  return problems;
}
