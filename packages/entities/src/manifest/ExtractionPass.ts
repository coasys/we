import type { CoreEntityDef } from './defs';

/**
 * That a call was read by a model, and how it went.
 *
 * ## Why the records are not enough
 *
 * An extraction pass produces records, and those are real, stored and queryable — so what a call
 * yielded survives on its own. What did not survive was everything about the *reading*: whether it
 * happened at all, when, who spent the tokens, and whether it failed. `interpretationStore` reports
 * all of that beautifully and reports it from a live subscription that starts empty and is thrown
 * away on every space change, so the moment you reload — or walk to another space and back — a call
 * that was read an hour ago is indistinguishable from one that never was, and a pass that *failed*
 * is indistinguishable from one that found nothing. Both of those are questions somebody asks about
 * a meeting they are reviewing, and the answer was gone.
 *
 * ## The prompt and the response are here, and they are the expensive part
 *
 * A prompt is the whole transcript, so one per pass in a shared neighbourhood means every member
 * replicating a second copy of every conversation, for a payload almost nobody opens.
 *
 * They are written anyway, because a log that omits what was actually asked cannot answer the
 * question people have about a pass: not "did it run" but "why did it decide *that*". So every
 * member of the space can read every exchange — which is also why this record, and not the live
 * relay, is how a peer's exchange reaches anyone: the relay never sends it. There was a space
 * setting that claimed to keep the exchange private; once this was written it no longer could, and
 * it was removed rather than left promising something untrue.
 *
 * ## Why it hangs off the call
 *
 * `CollectionBlock.extractionPasses`, so a panel showing one call reads its passes with the same
 * subject it reads everything else with. Before this, the readout had no call id to be scoped by at
 * all — the store's rows describe *every* pass this agent knows about — so a panel open on a past
 * call listed the live call's activity above that call's records and said nothing about the
 * mismatch.
 *
 * Its own relation rather than `children`, which holds a collection's *content*: a pass is a fact
 * about the collection, not something in it, and putting it in `children` would put it on the board.
 */
export const ExtractionPass: CoreEntityDef = {
  base: 'Ad4mModel',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://extraction_pass' },
    properties: {
      /**
       * How it ended — `done`, `failed`, or `skipped`.
       *
       * Three rather than a boolean because they are three different things to say to somebody
       * reviewing a call: it read the conversation, it tried and could not, or it had nothing to
       * look for. A `success: false` covering the last two is the shape that made a failed pass and
       * an empty one look identical in the live readout, which is the confusion this exists to end.
       */
      outcome: { type: 'string', predicate: 'we://outcome', default: 'done' },
      /**
       * How many records it wrote. `0` is a real answer and the common one on a short call.
       *
       * Stored rather than counted from the collection, because the records are not evidence of the
       * pass that made them: a second pass updates what the first found rather than duplicating it,
       * so counting afterwards attributes every record to whichever pass ran last.
       */
      recordCount: { type: 'number', predicate: 'we://record_count', default: 0 },
      /**
       * What it was looking for, as a JSON array of entity names.
       *
       * A blob because it is read back whole and never filtered on — and because the alternative, a
       * relation per target, would be a handful of links per pass for a list nobody queries across.
       * It is also the one thing that explains a pass that found nothing: a call looking for two
       * models finds none of a third, and without this the row says "0 records" and leaves the
       * reader to guess whether the conversation or the configuration was at fault.
       */
      targets: { type: 'string', predicate: 'we://extraction_targets', default: '' },
      /** Why it failed, verbatim from the backend. Empty on any other outcome. */
      error: { type: 'string', predicate: 'we://error', default: '' },
      /**
       * What started it — `manual` for a press of Extract now, `auto` for the standing watch.
       *
       * The reason there is one history rather than two. Only manual passes were written down at
       * all, and only automatic ones reached the live feed, so a call read automatically showed
       * records with no reading behind them and a call read by hand showed the opposite. Recording
       * both makes the two comparable, and this is the one fact that is lost by making them so.
       *
       * `manual` as the default because that is what the only writer wrote before this existed, so
       * a row from before the flag reads as what it actually was.
       */
      trigger: { type: 'string', predicate: 'we://trigger', default: 'manual' },
      /**
       * The prompt the model was given, verbatim. Empty where the executor did not report one.
       *
       * The large one. See the note above about what writing it costs and what it retracts — this
       * is not a field to copy onto another entity without reading that first.
       */
      prompt: { type: 'string', predicate: 'we://prompt', default: '' },
      /** What the model answered, verbatim. Same rules as {@link prompt}. */
      response: { type: 'string', predicate: 'we://response', default: '' },
    },
    // None. Who ran it is `author`, which every record carries, and when is `createdAt`.
    relations: {},
  },
};
