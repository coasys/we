/**
 * What a list of recorded calls is allowed to ask for.
 *
 * The Calls list draws one card per call, and each card wants two things about that call's
 * transcript: whether anybody spoke, and how much. Both were answered by a scoped query with no
 * bound and no condition — so a space with twenty recorded conversations of four hundred lines held
 * twenty live subscriptions over eight thousand rows to draw a list that shows none of them.
 *
 * The file's own note says `include` was avoided for exactly that reason. The per-card subscription
 * reintroduced it by another route, which is why this is asserted rather than left to a comment.
 */
import { describe, expect, it } from 'vitest';

import { callsList } from './CallsList';

const json = JSON.stringify(callsList);

/**
 * Every query in the list, as objects, so each can be judged on its own.
 *
 * Both spellings: `$query` inline on an `$each`, and every entry of a `$queries` block. The hoisted
 * ones are the expensive ones — a `$queries` on a card inside a list runs once per row — so a helper
 * that read only the inline form would have inspected the cheap half and reported it clean.
 */
function queries(node: unknown, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) {
    for (const item of node) queries(item, found);
    return found;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === '$query' && value && typeof value === 'object') found.push(value as Record<string, unknown>);
    if (key === '$queries' && value && typeof value === 'object') {
      for (const entry of Object.values(value as Record<string, unknown>)) {
        if (entry && typeof entry === 'object') found.push(entry as Record<string, unknown>);
      }
    }
    queries(value, found);
  }
  return found;
}

/**
 * A query that reads a call's lines. A line is a heard `TextBlock` or a typed message, which is a
 * `CollectionBlock` (see `callLines`), so such a query asks for both entities.
 */
const readsLines = (q: Record<string, unknown>): boolean =>
  Array.isArray(q.entity) ? q.entity.includes('TextBlock') : q.entity === 'TextBlock';

describe('the calls list', () => {
  /**
   * Every read of a transcript is bounded — including the hoisted one, which is the expensive one
   * because it runs per card rather than per opened card.
   */
  it('bounds every transcript it reads', () => {
    const transcripts = queries(callsList).filter(readsLines);
    expect(transcripts.length).toBeGreaterThan(0);
    for (const q of transcripts) expect(q.limit).toBeTypeOf('number');
  });

  /**
   * And follows only the call that can still change.
   *
   * A recorded call is a settled record: its transcript cannot change, so a subscription over one
   * costs the backend a re-query per change in the space to be told nothing changed. `liveCalls`
   * names the one call that is running, by record, so a list of past calls subscribes to nothing.
   */
  it('subscribes only to a call that is running', () => {
    const transcripts = queries(callsList).filter(readsLines);
    for (const q of transcripts) {
      expect(q.subscribe).toEqual({ $: 'call.id in modules.call.liveCalls.map(c, c.recordId)' });
    }
  });

  /**
   * And every OTHER query it holds is bounded too.
   *
   * The findings groups are one query per extractable model per card, so they outnumber the
   * transcripts they sit beside: eight models and twenty calls is a hundred and sixty
   * subscriptions. Asserted over every query rather than over a named one, so a group added later
   * cannot reintroduce the shape by another route — which is exactly how the transcript got here.
   */
  it('bounds every query on a card', () => {
    const all = queries(callsList);
    expect(all.length).toBeGreaterThan(2);
    for (const q of all) expect(q.limit).toBeDefined();
  });

  /**
   * The count is not decoration: it sits beside the faces and shows COVERAGE — the gap between who
   * was present and how much of them was captured. A card that reached the cap has to say so,
   * because a number that quietly stopped moving while the conversation went on would be a lie
   * about exactly the thing the number exists to tell the truth about.
   */
  it('says when it has stopped counting exactly', () => {
    expect(json).toContain('+ utterances');
  });

  /**
   * And still counts UTTERANCES rather than children.
   *
   * `children` carries what extraction wrote as well, so five utterances and three findings read as
   * "8 utterances" — which is the regression this list already fixed once. Bounding it must not
   * quietly swap the cheap wrong count back in.
   */
  it('counts the transcript rather than everything parented to the call', () => {
    const transcripts = queries(callsList).filter(readsLines);
    expect(transcripts.length).toBeGreaterThan(0);
    expect(json).not.toContain('count(call.children)');
  });

  /**
   * And counts a message typed into the call chat as one line.
   *
   * A typed message is a composition: a `CollectionBlock` with `kind: 'message'` under the call, and
   * its own `TextBlock` under it. Each read of the transcript asks for both entities, so the message
   * is a line, and the message's own `TextBlock` is not a second one.
   */
  it('reads heard lines and typed messages in each transcript query', () => {
    const transcripts = queries(callsList).filter(readsLines);
    // The card's count and the opened transcript, at least.
    expect(transcripts.length).toBeGreaterThanOrEqual(2);
    for (const q of transcripts) expect(q.entity).toEqual(['TextBlock', 'CollectionBlock']);
  });
});

describe('what a row of the list carries', () => {
  /**
   * A call is a container, and a container read without `select` carries the id of everything in it
   * — every utterance of every call, to draw a row that shows a title.
   */
  it('selects the fields the row draws, and not the transcript', () => {
    const list = queries(callsList).find((q) => (q.where as Record<string, unknown> | undefined)?.kind === 'call');
    expect(list?.select).toEqual(
      expect.arrayContaining(['title', 'description', 'author', 'createdAt', 'participants']),
    );
    expect(list?.select).not.toContain('children');
  });
});
