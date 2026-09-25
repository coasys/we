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
/*
  320 as well as 420, because two of the things this case now checks are about a control that has
  been squeezed: a slider's number stacking its own digits, and a list of types staying one per row.
*/
export const widths = [320, 420];

/** What the scenario puts on the record: two each of like, rating, vote and mood. */
const REACTIONS = 8;
/** Offered types. Four have been used; `Spark` has not. */
const OFFERED = 5;
const USED = 4;
/** Of the offered, the ones whose control IS a mark — `Like` and the unused `Spark`. */
const TOGGLES = 2;

export async function check({ measureAll, measurePart, measureControl, measureText, count, hover }, width) {
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
    And every compact mark says what the community means by it.

    A glyph is a heart or a star; what it MEANS is whatever the space decided, which is written in
    the type's description and was shown nowhere a reader would look. Two spaces can both have a
    star and mean quite different things by it.

    Only the compact ones, now. A full display that owns its line writes each name and description
    out beside its control, so a bubble repeating the line next to it would be chrome — `meaning`
    exists to say in a bubble what there was no room to write.
  */
  const tooltips = await count('we-tooltip');
  if (tooltips < USED) problems.push(`${tooltips} tooltips, expected one per compact mark`);

  /*
    The full display is a LIST — one type per row, not a strip they all run together in.

    A wrapping row in a panel blurs five types into one line: a heart, some stars, two arrows and a
    slider with nothing saying where one ends and the next begins, and the slider with no room to be
    dragged. Asserted as "no two controls share a top edge", which is what one-per-row means and what
    a wrapping row fails at every width wide enough to fit two.
  */
  const rows = await measureAll('.signal-control');
  const tops = rows.filter((box) => box.h).map((box) => Math.round(box.y));
  const shared = tops.filter((top, i) => tops.indexOf(top) !== i);
  if (shared.length) {
    problems.push(`${shared.length + 1} controls share a row at ${shared[0]}px — the full list is drawn as a strip`);
  }

  /*
    Every signal glyph is the same size, in every mode.

    Three mechanisms used to decide it — a component's own literal pixels, a button's context
    variable, and a size token named on a bare icon — and they agreed at `md` by coincidence and
    nowhere else. The slider's was the visible one at 32px against everyone else's 24, because it
    was the only glyph not inside a button and fell through to `we-icon`'s own default; a
    `we-button` at md gives its icons `--we-size-sm`, so a bare icon asking for md lands a step up.

    Measured rather than asserted per mode: the failure is that they DIFFER, so the test is that
    there is one answer, whatever it is.
  */
  // Not the Clear's own ×, which is chrome rather than a signal glyph and is deliberately smaller.
  const glyphs = (await measureAll('.signal-control we-icon:not(.signal-control__clear *)')).filter(
    (box) => box.w && box.h,
  );
  const widths = [...new Set(glyphs.map((box) => Math.round(box.w)))];
  if (widths.length > 1) {
    problems.push(`signal glyphs are ${widths.sort((a, b) => a - b).join(', ')}px — they should be one size`);
  }

  /*
    And every mode this agent has reacted with offers a way to take it back.

    Two of the four undo by pressing again; a rating only appeared to, because pressing your own
    star wrote `rangeMin`, which was 0, which used to mean delete — so a 1–5 rating had no way back
    at all and a slider never did. The Clear is the same control in every mode, and it is absent
    until there is something to withdraw, which is why the count is USED rather than OFFERED.
  */
  const clears = await count('.signal-control__clear');
  // One per used type in `full`, and one inside each popover the compact row opened for a used type.
  if (clears < USED) problems.push(`${clears} clear controls, expected one per reaction of this agent's`);

  /*
    A type's name is one line, whatever the control beside it is doing.

    In the sheet — 420px, less its padding — a rating's control left so little room for the naming
    column that `overflowWrap: anywhere` did what it is there to do and broke the words: "Rating"
    came out as a tower of single letters. The name shares the control's line now and the
    description runs full width underneath, so neither is competing for the same inches.

    Measured as height, because every letter is still present either way — the failure is the shape.
  */
  const names = await Promise.all(['Like', 'Rating', 'Vote', 'Mood'].map((word) => measureText(word)));
  for (const [i, box] of names.entries()) {
    if (box && box.h > 28) {
      problems.push(`the name "${['Like', 'Rating', 'Vote', 'Mood'][i]}" is ${box.h}px tall — it is being broken up`);
    }
  }

  /*
    In `full`, every control's reading is the same colour.

    `CountMark` colours its row so the digits follow the glyph, which is right for a COMPACT mark —
    the two are one quiet thing to glance at. In `full` the number is the community's reading, the
    same role the vote's net score and the rating's mean play, and both of those are plain text. So
    the like's count sat dimmed in a row of undimmed ones and read as a different kind of thing.

    Compared against the vote's count rather than against a literal colour, which is the claim that
    matters: they AGREE. A theme is free to move both.
  */
  const tones = [];
  for (let i = 0; i < 4; i++) {
    /*
      `measurePart`, never `measureAll` — a design-system colour lands on `[part='base']` and the
      HOST keeps whatever it inherited, which here is the row `CountMark` deliberately dims. Asked
      of the host, every reading answers with the colour of the box around it and the assertion is
      about nothing. The same trap the byline case records.
    */
    const toggle = await measurePart('.signal-control .count-mark__count', 'base', i);
    if (toggle && toggle.h) tones.push(toggle.color);
    const vote = await measurePart('.signal-control__count', 'base', i);
    if (vote && vote.h) tones.push(vote.color);
  }
  const distinct = [...new Set(tones)];
  if (!tones.length) problems.push('no readings were found to compare');
  if (distinct.length > 1) problems.push(`readings are drawn in ${distinct.length} colours: ${distinct.join(' / ')}`);

  /*
    And a control that says its value only while it is dragged says nothing at rest.

    Both the rating and the slider show their reading in a bubble during a drag. `we-tooltip` also
    opens on hover, so at rest — with nothing to say — it opened an empty card hanging off the
    control. A tooltip with no text and nothing slotted now stays shut.
  */
  // The pointer is put somewhere harmless first, because "with nothing hovered" is a state this has
  // to ESTABLISH rather than assume: a case that hovers something leaves it hovered, and the next
  // width reuses the page — so this read the previous pass's tooltip and blamed it on rest.
  await hover('body');
  const empties = await count('we-tooltip[open]');
  if (empties) problems.push(`${empties} tooltips are open with nothing hovered`);

  /*
    And a number is one line, whatever room it is given.

    Every typography surface defaults `overflow-wrap: anywhere`, which is right for a URL and wrong
    for a figure — so the slider's reading, squeezed between a glyph and its track, put the 5 above
    the 3 of "53". Measured as height rather than as text, because the digits are all still there:
    the failure is that they are stacked.
  */
  const digits = await measureAll('we-number');
  for (const box of digits.filter((one) => one.h)) {
    if (box.h > 24) problems.push(`a number is ${box.h}px tall at ${width}px — its digits are stacked`);
  }

  /*
    A compact mark's bubble says who is behind it.

    The mark itself says a glyph and a number and nothing about the people, and the bubble
    explaining what the mark MEANS is where somebody is already looking. Faces rather than a roster:
    the names and the values are in the sheet where they can be searched, and a hover-only list
    would put the answer somewhere a touchscreen cannot reach.

    Hovered rather than assumed — the content is in a slot, so it is in the tree either way; what is
    being checked is that a reader who points at a mark is shown it.
  */
  await hover('we-tooltip .count-mark we-button');
  const faces = await count('we-tooltip[open] we-avatar');
  if (!faces) problems.push('hovering a mark says nothing about who reacted');

  return problems;
}
