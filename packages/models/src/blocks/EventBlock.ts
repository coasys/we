import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

/** See the note on {@link TaskBlock} for why these hints are worded the way they are. */
@Model({
  name: 'EventBlock',
  interpretationHint:
    'Something happening at a identifiable future time — a meeting, a trip, a deadline event, ' +
    'an occasion. A day is enough; it does not need a time of day, an agreement between the ' +
    'speakers, or other attendees. "Visiting my grandma this weekend" is an event. ' +
    'Exclude only the conversation currently happening, and intentions with no when at all.',
})
export class EventBlock extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://event_block' })
  flag: string = '';

  /**
   * What makes two mentions the same *occasion* — the title and the day, joined.
   *
   * A dedup key rather than something to display, and it exists because interpretation allows a
   * class exactly one identity property (see {@link TaskBlock.title}). Title alone is the obvious
   * choice and is wrong here in a way that only shows up over time: a weekly standup is the same
   * title every week and a different occasion every week, so a title key silently collapses every
   * occurrence into one record. A date alone is worse — two unrelated things on one afternoon.
   *
   * So the key is composite, and since the mechanism keys on a single property, "composite" has to
   * mean a property whose *value* is composite. Written by the model rather than derived, because
   * machine-written instances go through `create_subject` server-side and never pass WE's own write
   * path, so there is nowhere for us to compute it.
   *
   * **It is denormalised and nothing recomputes it.** Rename the event or move the date and this
   * still says what it said, so the next pass sees a different occasion and writes a new record.
   * That is the accepted cost of a single-property key, and it degrades in the safe direction — a
   * duplicate a human deletes, rather than two real occasions silently merged. It also stays useful
   * once stale: later prompts show it under `properties`, so the model can see what this instance
   * was originally taken to be.
   *
   * Not `required`, deliberately. Required would mean the constructor writing `uninitialized` for
   * every event created by hand through the composer — and then two hand-made events would share a
   * key and dedup into each other, which is the exact failure this field exists to prevent. Left
   * unset, an instance is simply invisible to dedup, which is the right answer for a record no
   * machine is managing.
   *
   * `@Property` rather than `@Optional` even though it is optional: properties are already optional
   * by default, and `@Optional` does not default `resolveLanguage` the way `@Property` does, so the
   * class and its compiled manifest disagree about storage and the round-trip test fails.
   */
  @Property({
    through: 'we://occurrence',
    identity: true,
    interpretationHint:
      'A dedup key, not a display value: the title and the start date joined, e.g. ' +
      '"Design review 2026-08-20". Always set it when you create an event. Reuse an existing ' +
      "event's exact value only when this is the same occasion on the same day.",
  })
  occurrence: string = '';

  @Property({
    through: 'we://title',
    required: true,
    interpretationHint:
      'What the occasion is called, e.g. "Design review". No trailing period. ' +
      'Never include the bracketed timestamp that starts each turn — it is metadata, not speech.',
  })
  title: string = '';

  @Property({
    through: 'we://description',
    interpretationHint: 'What it is for, if said. Omit rather than restate the title.',
  })
  description: string = '';

  @Property({
    through: 'we://start_date',
    required: true,
    interpretationHint:
      'Start as YYYY-MM-DDTHH:mm (local time, no timezone suffix). Resolve relative dates like ' +
      '"next Tuesday at 3", "this weekend" or "on Friday" against the bracketed timestamp leading ' +
      'that turn — pick the nearest matching future date. When only a day was said, use T00:00 and ' +
      'set allDay true. Required, so give your best resolution rather than omitting the event.',
  })
  startDate: string = '';

  @Property({
    through: 'we://end_date',
    interpretationHint: 'End as YYYY-MM-DDTHH:mm. Omit unless a duration or end time was actually stated.',
  })
  endDate: string = '';

  @Property({
    through: 'we://location',
    interpretationHint: 'Where it happens — a place or a link, as said. Omit if unstated.',
  })
  location: string = '';

  @Property({
    through: 'we://all_day',
    interpretationHint: 'True whenever only a day was said and no time of day — the common case in speech.',
  })
  allDay: boolean = false;

  @Property({ through: 'we://version' })
  version: number = 0;
}
