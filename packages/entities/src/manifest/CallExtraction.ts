import type { CoreEntityDef } from './defs';

/**
 * What one call extracts, when its participants want something other than the space's default.
 *
 * The third and innermost of three layers, and the only one that is per-conversation:
 *
 * 1. **The codebase** says what is a *candidate* — `EntitySchema.extractable`. An entity earns it by
 *    having hints, a dedup key, and no required field a model cannot satisfy (which is why no media
 *    block is one: `ImageBlock.src` is a required content address, and a model asked for one invents
 *    it).
 * 2. **The space** says which candidates its calls *start* with — `Space.extractionTargets`. What a
 *    community's conversations are about is the community's to say, not WE's.
 * 3. **This** says what *this* call is doing, because a design review and a birdwatching walk are
 *    different meetings in the same space.
 *
 * ### Why a record rather than links on the collection
 *
 * The obvious alternative is one `we://extraction_target` link per class on the call's own
 * collection, which would be conflict-free per class. It is rejected because zero links and "nobody
 * has touched this" are then the same state, so a group that deliberately turned *everything* off
 * would silently fall back to the space default — the exact "empty means not-decided, not none"
 * trap `Space.enabledModules` documents. A record's existence is the customization, so removing the
 * last target is expressible.
 *
 * The cost is that `entities` is rewritten whole, so two participants toggling in the same instant
 * lose one edit. That is the same trade `enabledModules` and `enabledViews` already make, and it is
 * the right one here: this is a settings list a person presses occasionally, not a transcript many
 * agents append to concurrently.
 *
 * ### Why it lives in the space rather than in the root dataset
 *
 * Unlike `ReadMarker` and `SpacePreference`, this is **not** per-agent. A standing watch is one
 * registration the whole neighbourhood shares and whichever peer wins the election spends its own
 * LLM call running it, so what a call extracts has to be one value every member reads — otherwise
 * two peers would each re-register over the other's list in a loop. It is a group decision about a
 * shared conversation, so it is shared state.
 *
 * ### Changing it mid-call
 *
 * Supported, and the reason the standing watch re-registers rather than being written once. Adding a
 * target part-way through only affects what is said *from then on*, because the watch keeps a
 * processed-turn cursor — so the honest affordance for the rest is the one-shot Extract button,
 * which takes the transcript explicitly, carries no cursor, and re-reads the whole conversation
 * against the current list. The executor's dedup means what was already found comes back as updates
 * rather than duplicates.
 */
export const CallExtraction: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: { predicate: 'we://flag', value: 'we://call_extraction' },
    properties: {
      /**
       * The call this belongs to — the id of its `CollectionBlock`.
       *
       * A scalar rather than a relation, following `ReadMarker.nodeId`: one query per space returns
       * every call's settings at once, which is what a list of calls needs, where a relation would
       * be one drill-down per card.
       */
      callId: { type: 'string', predicate: 'we://call_id', default: '' },
      /**
       * The entity names this call extracts, as a JSON array.
       *
       * **`[]` means none, and that is different from having no record at all.** A call with no
       * record follows the space; a call whose participants turned everything off has this empty and
       * extracts nothing. Collapsing the two is the bug this record exists to make impossible.
       *
       * A JSON string rather than a relation for the reason `Space.enabledModules` gives: the values
       * are entity *names*, not entities in the perspective — there is nothing to point at.
       */
      entities: { type: 'string', predicate: 'we://extraction_targets', default: '' },
    },
    relations: {},
  },
};
