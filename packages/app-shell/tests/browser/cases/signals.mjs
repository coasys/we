/**
 * The three densities draw genuinely different things.
 *
 * Each is easy to get right on its own, and that is the risk: a `compact` that quietly drew every
 * control, or a `total` that drew a mark per type, would satisfy any assertion written about it in
 * isolation. So all three are mounted on one record with one of each kind of type on it — a toggle,
 * a rating, a vote — plus one nobody has used, and the case is about how they differ.
 */
export const name = 'signal densities';
export const scenario = 'signals:vocabulary';
export const widths = [420];

/** What the scenario puts on the record: two likes, two ratings, two votes. */
const REACTIONS = 6;
/** Offered types. Three have been used; `Spark` has not. */
const OFFERED = 4;
const USED = 3;
/** Of the offered, the ones whose control IS a mark — `Like` and the unused `Spark`. */
const TOGGLES = 2;

export async function check({ measureAll, measurePart, measureControl, count }) {
  const problems = [];

  /*
    Compact keeps a way to what it is hiding, and it is on screen before it is needed.

    `Spark` is offered here and nobody has used it, so `compact` does not draw it — on the promise
    that the sheet is how the rest are reached. That door used to be the `+N` overflow and nothing
    else, which meant it appeared only once a FIFTH type was in use: with four offered and three
    used, exactly this scenario, the row drew three marks and no way to give a fourth kind of
    reaction. A mode that hides a vocabulary needs something to open it, at every count.
  */
  const door = await measureControl('React with something else');
  if (!door) problems.push('compact hides a type nobody has used with no way to reach it');
  else if (!door.w || !door.h) problems.push('the way into the sheet has no box, so it cannot be pressed');

  const marks = await measureAll('.count-mark');
  const controls = await measureAll('.signal-control');

  /*
    One mark for `total`, one per USED type in `compact`, and one for each toggle in `full` —
    because a toggle's real control IS a mark, so `SignalControl` draws it by delegating here.

    Counted across all three rather than per mode, which is the point: a mark per OFFERED type in
    compact would be one more, and a `total` that had quietly become a compact row would be two
    more. Either reads as a passing count when the modes are checked one at a time.
  */
  const expectedMarks = 1 + USED + TOGGLES;
  if (marks.length !== expectedMarks) {
    problems.push(`${marks.length} marks, expected ${expectedMarks} — one total, ${USED} compact, ${TOGGLES} toggles`);
  }

  /*
    `full` is every offered type as its own control — including the one nobody has used, which is
    exactly the type that needs a control if a community's vocabulary is to be reachable at all —
    plus the one inside each popover, since a popover holds the type's real control rather than a
    second drawing of it.
  */
  const expectedControls = OFFERED + (USED - 1);
  if (controls.length !== expectedControls) {
    problems.push(`${controls.length} controls, expected ${OFFERED} in full and ${USED - 1} in popovers`);
  }

  /*
    A popover for each kind whose control is not a mark.

    A toggle presses straight through — opening a popover to show the same heart again is a door in
    front of a doorway. A rating's five stars ARE the reading and a vote has two ends; neither
    survives being collapsed to one press. Two of the three used types, then.
  */
  const popovers = await count('we-popover');
  if (popovers !== USED - 1) problems.push(`${popovers} popovers, expected one per non-toggle used type`);

  // The total counts people, not values: six records, whatever they said.
  const total = await measurePart('we-number', 'base', 0);
  if (total && total.text !== String(REACTIONS)) {
    problems.push(`the total reads "${total.text}", expected ${REACTIONS} reactions`);
  }

  /*
    And every mark says what the community means by it.

    A glyph is a heart or a star; what it MEANS is whatever the space decided, which is written in
    the type's description and was shown nowhere a reader would look. Two spaces can both have a
    star and mean quite different things by it.
  */
  const tooltips = await count('we-tooltip');
  if (tooltips < USED + OFFERED) problems.push(`${tooltips} tooltips, expected one per drawn type`);

  return problems;
}
