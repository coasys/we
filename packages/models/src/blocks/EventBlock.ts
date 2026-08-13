import { Flag, Model, Property } from '@coasys/ad4m';

import { WeNode } from '../WeNode';

/** See the note on {@link TaskBlock} for why these hints are worded the way they are. */
@Model({
  name: 'EventBlock',
  interpretationHint:
    'A meeting or occasion scheduled for a specific future time that participants agreed on. ' +
    'Not the conversation currently happening, and not a vague intention to meet "sometime".',
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
      '"next Tuesday at 3" against the bracketed timestamp leading that turn. ' +
      'Required — do not invent an event without a stated time.',
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
    interpretationHint: 'True only when a date was given with no time of day.',
  })
  allDay: boolean = false;

  @Property({ through: 'we://version' })
  version: number = 0;
}
