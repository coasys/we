import type { CoreEntityDef } from './defs';

/** See the note on {@link TaskBlock} for why these hints are worded the way they are. */
export const EventBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    blockable: true,
    description: 'Something happening at a time — a meeting, a deadline, a gathering',
    /*
      Where it happens is said here rather than on the relation, because `RelationSchema` carries no
      hint of its own — the executor's prompt has a slot for one, and WE's manifest has nowhere to
      declare it. Worth adding one day; a sentence in the class hint reaches the same prompt today.
    */
    interpretationHint:
      'Something happening at a identifiable future time — a meeting, a trip, a deadline event, an occasion. A day is enough; it does not need a time of day, an agreement between the speakers, or other attendees. "Visiting my grandma this weekend" is an event. Exclude only the conversation currently happening, and intentions with no when at all. For `location`, link a LocationBlock only when a place was actually named: reference an existing one by id where the name already matches, otherwise create one and reference it. Never invent a place from the topic of the conversation.',
    flag: { predicate: 'we://flag', value: 'we://event_block' },
    /** The other core extraction target — see {@link TaskBlock} and `EntitySchema.extractable`. */
    extractable: true,
    // `occurrence` is absent on purpose: it is a dedup key a machine maintains, and asking an
    // author for one would hand two hand-made events the same key — see its own note below.
    // `location` has left too, being a relation now: the generated form is built from properties,
    // and a relation wants a picker over existing places rather than a text box.
    authoring: { fields: ['title', 'description', 'startDate', 'endDate', 'allDay'] },
    /*
      What a card shows, which is not what a form asks for.

      Two absences, for opposite reasons. `occurrence` is machine bookkeeping — its own note calls
      it "a dedup key rather than something to display" — and it was reaching review cards, where a
      title and a date glued together read as a third, redundant field nobody could interpret.

      `allDay` is genuinely redundant rather than internal: a card renders a midnight time as a bare
      date, so an all-day event already looks like one. Saying "All day: true" underneath is the
      same fact twice, and on a card whose whole job is a quick decision that is one line of noise.
      It stays in `authoring`, because a *form* has to be able to set what a card can infer.

      A block comment rather than a docblock: `generate:classes` lifts JSDoc from properties and
      relations onto the generated class, and has nowhere to put one attached to an entity-level
      key — so a docblock here is prose the round-trip test then reports as missing from the class.
    */
    display: { fields: ['title', 'description', 'startDate', 'endDate'] },
    properties: {
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
      occurrence: {
        type: 'string',
        predicate: 'we://occurrence',
        interpretationHint:
          'A dedup key, not a display value: the title and the start date joined, e.g. "Design review 2026-08-20". Always set it when you create an event. Reuse an existing event\'s exact value only when this is the same occasion on the same day.',
        identity: true,
        default: '',
      },
      title: {
        type: 'string',
        predicate: 'we://title',
        required: true,
        interpretationHint:
          'What the occasion is called, e.g. "Design review". No trailing period. Never include the bracketed timestamp that starts each turn — it is metadata, not speech.',
        default: '',
      },
      description: {
        type: 'string',
        control: 'textarea',
        predicate: 'we://description',
        interpretationHint: 'What it is for, if said. Omit rather than restate the title.',
        default: '',
      },
      startDate: {
        type: 'string',
        control: 'datetime',
        predicate: 'we://start_date',
        required: true,
        interpretationHint:
          'Start as YYYY-MM-DDTHH:mm (local time, no timezone suffix). Resolve relative dates like "next Tuesday at 3", "this weekend" or "on Friday" against the bracketed timestamp leading that turn — pick the nearest matching future date. When only a day was said, use T00:00 and set allDay true. Required, so give your best resolution rather than omitting the event.',
        default: '',
      },
      endDate: {
        type: 'string',
        control: 'datetime',
        predicate: 'we://end_date',
        interpretationHint: 'End as YYYY-MM-DDTHH:mm. Omit unless a duration or end time was actually stated.',
        default: '',
      },
      allDay: {
        type: 'boolean',
        predicate: 'we://all_day',
        interpretationHint: 'True whenever only a day was said and no time of day — the common case in speech.',
        default: false,
      },
      version: {
        type: 'number',
        predicate: 'we://version',
        interpretationHint: 'Bookkeeping. Never set this \u2014 WE maintains it.',
        default: 0,
      },
    },
    relations: {
      /**
       * Where it happens — the place itself, not the word for it.
       *
       * ## Why this stopped being a string
       *
       * `we://location` meant two incompatible things. On `Space` it is a relation to a
       * `LocationBlock`; here it was a literal, so anything reading `?x we://location ?y` got a mix
       * of place records and bare strings under one predicate. Sharing a predicate is the point of
       * the vocabulary, and sharing one across two *shapes* is the version of that which cannot
       * work — see `entities/CONVENTIONS.md` on preferring generic predicates.
       *
       * A place is also a thing rather than a word. As a string it could not be put on a map, could
       * not be the same Bristol as the one on another event, and carried nothing an address, a
       * country or a set of coordinates could hang off. `LocationBlock` is where all of that already
       * lives, and `Space` has been using it all along.
       *
       * ## What a pass has to do now
       *
       * Mint the location and link it in the same run. The engine renders forward relations into the
       * prompt and resolves a `new:<Class>:<n>` ordinal into the instance it created earlier in that
       * batch, so this is one proposal, not two round trips — and `LocationBlock.name` is its
       * identity, so a place mentioned three times in a call is one record linked three times.
       *
       * ## What it costs
       *
       * Values already written as strings under this predicate are stranded: the predicate survives,
       * so nothing warns, and a relation read finds no node where a literal sits. Accepted rather
       * than migrated because the alternative is a mapping only the author can supply for data that
       * predates any external consumer — but it is a real loss, deliberately taken, and it is the
       * reason to do this now rather than later.
       */
      location: { target: 'LocationBlock', cardinality: 'one', predicate: 'we://location' },
    },
  },
};
