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
