/**
 * A layout element with `hoverProps` draws the border it is given, at rest and lit.
 *
 * The state stylesheet declares the border shorthand, then colour and width, then each side, so a
 * side wins — and a side nobody set reset to none. Every card that lights on hover drew no border,
 * the Social DNA page's chosen card among them.
 */
export const name = 'a card that lights on hover keeps its border';
export const scenario = 'border:with-hover';
export const widths = [480];

export async function check({ evaluate, hover }) {
  const problems = [];
  const border = (probe) =>
    evaluate((probe) => {
      const cs = getComputedStyle(document.querySelector(`[data-probe="${probe}"]`));
      return [cs.borderTopStyle, cs.borderTopWidth, cs.borderLeftStyle, cs.borderTopColor];
    }, probe);

  const resting = await border('resting');
  if (resting[0] !== 'solid' || resting[1] !== '2px' || resting[2] !== 'solid')
    problems.push(`a border at rest is drawn as ${JSON.stringify(resting)}, not 2px solid`);

  const before = await border('lit');
  await hover('[data-probe="lit"]');
  const lit = await border('lit');
  if (lit[0] !== 'solid' || lit[1] !== '2px') problems.push(`a border when lit is drawn as ${JSON.stringify(lit)}`);
  else if (lit[3] === before[3]) problems.push(`the border did not change colour when lit: ${before[3]}`);
  return problems;
}
