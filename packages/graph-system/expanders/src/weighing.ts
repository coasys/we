/**
 * A card's reactions as one number, with each person's voice weighted as the reader chooses.
 *
 * Split in two, because the two halves run at different moments. What each person answered is read when
 * the canvas is fetched — it needs the rows, and the rows need a query. What those answers add up to
 * depends on how much each person's voice counts, which a reader changes with a slider many times a
 * second; that half runs in the seed's `derive`, over answers already on the cards, and asks nothing of
 * the backend. See `SeedSource.derive`.
 */
import type { GraphValue } from '@we/graph-protocol';

/** One person's answer on one card: who, and what they gave. */
export type Vote = [author: string, value: number];

export type Aggregate = 'count' | 'sum' | 'mean' | 'median';

/** The aggregate a mode falls back to — `aggregateFor` in `@we/components`, which this must agree with. */
const AGGREGATE_FOR_MODE: Record<string, 'count' | 'sum' | 'mean'> = {
  toggle: 'count',
  vote: 'sum',
  rating: 'mean',
  slider: 'mean',
};

/**
 * How a reaction type's values are read as one number: its own `aggregate`, unless that cannot express
 * what its mode draws.
 *
 * The rule is `aggregateFor` in `@we/components`, restated because the graph packages do not depend on
 * the design system; a test in the app shell holds the two to the same answer for every pair. Its
 * reason, in short: `aggregate` defaults to `count` in the manifest and nothing has ever asked for it,
 * so every type a community has made carries `count` whatever its mode — and a rating read as a count
 * orders cards by how many people rated them.
 */
export function effectiveAggregate(aggregate?: string, mode?: string): Aggregate {
  const fallback = (mode && AGGREGATE_FOR_MODE[mode]) || 'count';
  if (!aggregate) return fallback;
  if (aggregate === 'count' && mode && mode !== 'toggle') return fallback;
  return aggregate === 'sum' || aggregate === 'mean' || aggregate === 'median' ? aggregate : 'count';
}

/**
 * Each person's newest answer of one type, from a card's reaction rows — or null where the rows were not
 * read at all, which is not the same as nobody having answered.
 *
 * **One voice per person.** A shared perspective is last-write-wins and writable by every member, so the
 * same agent can end up holding two reactions of one kind on one record — two devices, or a write either
 * side of a partition. Counting both would let a card gain weight from somebody having been offline.
 *
 * An unattributed reaction is left out: nothing can be said about it — not whose it is, not whether the
 * reader has muted them, not whether it duplicates one already counted.
 */
export function readVotes(rows: unknown, type: string): Vote[] | null {
  if (!type || !Array.isArray(rows)) return null;
  const latest = new Map<string, { value: number; at: string }>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const signal = row as Record<string, unknown>;
    if (signal.signalTypeId !== type) continue;
    const author = typeof signal.author === 'string' ? signal.author : '';
    if (!author) continue;
    const value = Number(signal.value);
    const at = typeof signal.createdAt === 'string' ? signal.createdAt : '';
    const held = latest.get(author);
    // `>=` so a pair with no timestamps at all still settles on one of them rather than on neither.
    if (held && held.at >= at) continue;
    latest.set(author, { value: Number.isFinite(value) ? value : 0, at });
  }
  return [...latest].map(([author, entry]) => [author, entry.value]);
}

/**
 * How much each person's voice counts, from however it was written down: `did=50,did=0` as the address
 * holds it (whole percent), or an object of fractions. Anyone not named counts in full; a DID holds
 * colons and never an `=` or a comma, which is what makes the address form safe.
 */
export function parseWeights(weights: unknown): Map<string, number> {
  const parsed = new Map<string, number>();
  const put = (who: string, share: number) => {
    if (who && Number.isFinite(share)) parsed.set(who, Math.min(1, Math.max(0, share)));
  };
  if (typeof weights === 'string') {
    for (const entry of weights.split(',')) {
      const split = entry.lastIndexOf('=');
      // An empty share is not a zero: `Number('')` is 0, and would mute somebody over a stray `=`.
      const share = entry.slice(split + 1).trim();
      if (split > 0 && share) put(entry.slice(0, split).trim(), Number(share) / 100);
    }
  } else if (weights && typeof weights === 'object') {
    for (const [who, share] of Object.entries(weights as Record<string, unknown>)) put(who, Number(share));
  }
  return parsed;
}

export interface WeighSettings {
  signalTypeId: string;
  /** How the values are read as one number — the type's own `aggregate`, read through its `mode`. */
  aggregate?: string;
  mode?: string;
  /** DIDs whose reactions are ignored — a reader's muted list. */
  excludeAuthors?: string[];
  /** Whose answer is the reader's own — what `weightMine` reports. */
  me?: string;
  /** How much each person's voice counts — see {@link parseWeights}. */
  weights?: unknown;
}

/**
 * One card's answers as its weight, with how many people's voices went into it, what the reader gave,
 * how it was read, and — as `weightAdjusted` — whether anybody who answered it is turned down.
 *
 * With every voice in full this is the plain aggregate: a count of people, a net vote, an average, a
 * median. A voice turned down counts for its share of a person — half a like, half a vote, half a say in
 * the average — and a voice at nothing is left out altogether, exactly like a muted one.
 *
 * **No reactions is absent, not zero — except for a count.** A card nobody has voted on or rated and the
 * lowest-scoring card are different facts: absent sorts last whichever way the order runs, and leaves a
 * heat rule falling through to "no answers yet". A count is the exception because there the two facts are
 * one: no likes *is* a score, zero. The same holds when every voice on a card has been turned to nothing —
 * nobody the reader is listening to has answered.
 */
export function weighVotes(votes: readonly Vote[], settings: WeighSettings): Record<string, GraphValue> {
  const aggregate = effectiveAggregate(settings.aggregate, settings.mode);
  const about: Record<string, GraphValue> = { weightType: settings.signalTypeId, weightAggregate: aggregate };
  const muted = new Set(settings.excludeAuthors ?? []);
  const weights = parseWeights(settings.weights);

  const mine = settings.me ? votes.find(([author]) => author === settings.me) : undefined;
  if (mine) about.weightMine = mine[1];

  const heard = votes
    .filter(([author]) => !muted.has(author))
    .map(([author, value]) => ({ value, weight: weights.get(author) ?? 1 }));
  // Somebody who answered this card counts for less than a whole voice — what a badge says as "weighted".
  if (heard.some((vote) => vote.weight < 1)) about.weightAdjusted = true;
  const counted = heard.filter((vote) => vote.weight > 0);
  if (!counted.length) return aggregate === 'count' ? { ...about, weight: 0, weightCount: 0 } : about;

  const say = counted.reduce((total, vote) => total + vote.weight, 0);
  let weight: number;
  switch (aggregate) {
    case 'sum':
      weight = counted.reduce((total, vote) => total + vote.weight * vote.value, 0);
      break;
    case 'mean':
      weight = counted.reduce((total, vote) => total + vote.weight * vote.value, 0) / say;
      break;
    case 'median':
      weight = weightedMedian(counted);
      break;
    default:
      // `count` — how many people answered, each counting for their share of a voice.
      weight = say;
  }
  return { ...about, weight, weightCount: counted.length };
}

/**
 * The value half the say lies at or below — the median, with each value counting for its weight. Where
 * the halfway point falls exactly between two values, their midpoint, which is the ordinary median's
 * answer for an even count when every weight is equal.
 */
function weightedMedian(votes: { value: number; weight: number }[]): number {
  const sorted = [...votes].sort((a, b) => a.value - b.value);
  const half = sorted.reduce((total, vote) => total + vote.weight, 0) / 2;
  let running = 0;
  for (let i = 0; i < sorted.length; i++) {
    running += sorted[i].weight;
    if (Math.abs(running - half) < 1e-9 && i + 1 < sorted.length) return (sorted[i].value + sorted[i + 1].value) / 2;
    if (running > half) return sorted[i].value;
  }
  return sorted[sorted.length - 1].value;
}

/** The whole of the old single-step API: a card's rows read and weighed at once. */
export function weighSignals(rows: unknown, settings: WeighSettings): Record<string, GraphValue> {
  const votes = readVotes(rows, settings.signalTypeId);
  return votes ? weighVotes(votes, settings) : {};
}

// ─── Pretend people ────────────────────────────────────────────────────────────

/**
 * People who are not there, answering on every card — for trying out weighting without several real
 * agents. A development tool: nothing here is written anywhere, and a production build never passes it.
 *
 * AD4M signs every record with the key of the agent that wrote it, so there is no honest way to store a
 * reaction as somebody else. These are mixed into the answers already read, just before they are weighed,
 * so everything downstream — the order, the heat map, the badges, the list of voices — sees them as it
 * would see real ones.
 */
export interface Pretend {
  people: { id: string; name: string }[];
  /**
   * Answers somebody gave while acting as one of them, by `person|record` — a value, or null for one
   * taken back. They win over the made-up answer for that pair.
   */
  answers?: Record<string, number | null>;
  /** The pretend person whose answer is the reader's own — see `WeighSettings.me`. */
  actingAs?: string;
}

/** The range a made-up answer is drawn from, from the reaction type. */
export interface PretendRange {
  mode?: string;
  rangeMin?: number;
  rangeMax?: number;
  step?: number;
}

/** A number in [0, 1) fixed by a string — so a pretend person's answers are the same on every load. */
function unit(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

/** What one pretend person gave on one card, made up but settled — or null where they did not answer. */
function madeUp(person: string, record: string, range: PretendRange): number | null {
  const roll = unit(`${person}|${record}`);
  const pick = unit(`${record}|${person}|value`);
  const min = Number.isFinite(range.rangeMin) ? Number(range.rangeMin) : 0;
  const max = Number.isFinite(range.rangeMax) ? Number(range.rangeMax) : 1;
  switch (range.mode) {
    case 'toggle':
      return roll < 0.55 ? max || 1 : null;
    case 'vote':
      return roll < 0.35 ? -1 : roll < 0.85 ? 1 : null;
    default: {
      if (roll >= 0.85) return null;
      const step = range.step && range.step > 0 ? range.step : range.mode === 'rating' ? 1 : (max - min) / 20 || 1;
      return Math.min(max, Math.round((min + pick * (max - min)) / step) * step);
    }
  }
}

/** The pretend people's answers on one card, after what anybody acting as them has changed. */
export function pretendVotes(record: string, pretend: Pretend | undefined, range: PretendRange): Vote[] {
  if (!pretend?.people?.length || !record) return [];
  const votes: Vote[] = [];
  for (const person of pretend.people) {
    const key = `${person.id}|${record}`;
    const given = pretend.answers && key in pretend.answers ? pretend.answers[key] : madeUp(person.id, record, range);
    if (typeof given === 'number' && Number.isFinite(given)) votes.push([person.id, given]);
  }
  return votes;
}

// ─── Voices ────────────────────────────────────────────────────────────────────

/** One person whose answers went into the scores: how many cards they answered, and their average. */
export interface Voice {
  author: string;
  cards: number;
  mean: number;
  /** A pretend person's name — a real one's comes from their profile. */
  name?: string;
}

/** Everybody who answered on any card, the busiest first — what a reader turns up or down. */
export function voicesOf(votes: readonly Vote[][], muted: readonly string[], pretend?: Pretend): Voice[] {
  const quiet = new Set(muted);
  const names = new Map((pretend?.people ?? []).map((person) => [person.id, person.name]));
  const tally = new Map<string, { cards: number; total: number }>();
  for (const card of votes) {
    for (const [author, value] of card) {
      if (quiet.has(author)) continue;
      const held = tally.get(author) ?? { cards: 0, total: 0 };
      held.cards += 1;
      held.total += value;
      tally.set(author, held);
    }
  }
  return [...tally]
    .map(([author, { cards, total }]) => ({
      author,
      cards,
      mean: Math.round((total / cards) * 10) / 10,
      ...(names.has(author) ? { name: names.get(author) } : {}),
    }))
    .sort((a, b) => b.cards - a.cards || a.author.localeCompare(b.author));
}
