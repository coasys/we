/**
 * Whose reactions a weighted score was made from, and how much each of them counts — for the list a
 * reader turns voices up and down in.
 *
 * The canvas seed reports the voices — who answered with the reaction the tree is ordered by, on how many
 * cards, and what they gave on average — as a summary beside the graph; how much each counts is held in
 * the address as `did=50,did=0`, whole percent, anyone not named in full. These two functions are the
 * joins a schema cannot write: the one to a face and a name, and the one back to that address form.
 */
import { parseWeights } from '@we/graph-expanders';

interface ProfileRow {
  did?: string;
  name?: string;
  avatar?: string;
}

interface VoiceRow {
  author?: string;
  cards?: number;
  mean?: number;
  name?: string;
}

/** One voice as a list draws it. */
export interface VoiceView {
  did: string;
  name: string;
  avatar: string;
  /** Cards they answered on, and their average answer there. */
  cards: number;
  mean: number;
  /** How much their voice counts, 0–100. */
  weight: number;
  /** Their share of everybody's say, 0–100 — what "Ana 60%" reads. */
  share: number;
  mine: boolean;
  /** A pretend person, from the development tool — never a real agent. */
  pretend: boolean;
}

/** A DID as something to call a person whose profile has not arrived. */
const shortDid = (did: string) => (did.length > 16 ? `${did.slice(0, 12)}…${did.slice(-4)}` : did);

/**
 * The voices from a seed's summary, each with its face, its weight from the address and its share of
 * the say. Options: summary (what `onSeedSummary` reported), param (the address form), profiles
 * (profileStore.profiles), me (me.did).
 */
export function voices(options: unknown): VoiceView[] {
  const { summary, param, profiles, me } = (options ?? {}) as {
    summary?: { voices?: unknown };
    param?: unknown;
    profiles?: unknown;
    me?: unknown;
  };
  const rows = Array.isArray(summary?.voices) ? (summary.voices as VoiceRow[]) : [];
  const byDid = new Map(
    (Array.isArray(profiles) ? (profiles as ProfileRow[]) : []).flatMap((profile) =>
      profile?.did ? [[profile.did, profile] as const] : [],
    ),
  );
  const weights = parseWeights(param);
  const listed = rows
    .filter((row) => typeof row.author === 'string' && row.author)
    .map((row) => {
      const did = row.author as string;
      const profile = byDid.get(did);
      const pretend = typeof row.name === 'string' && !!row.name;
      return {
        did,
        name: pretend ? (row.name as string) : profile?.name || shortDid(did),
        avatar: pretend ? '' : profile?.avatar || '',
        cards: Number(row.cards) || 0,
        mean: Number(row.mean) || 0,
        weight: Math.round((weights.get(did) ?? 1) * 100),
        share: 0,
        mine: did === me,
        pretend,
      };
    });
  const total = listed.reduce((sum, voice) => sum + voice.weight, 0);
  for (const voice of listed) voice.share = total ? Math.round((voice.weight / total) * 100) : 0;
  return listed;
}

/**
 * The address form with one voice changed — or, with `only`, every listed voice at nothing but that one.
 * A voice back at full is left out, so a reader who puts everything back has a clean address. Options:
 * param (the address form now), did and weight (0–100), or only (a DID) with voices (the listed rows or
 * their DIDs).
 */
export function voicesParam(options: unknown): string {
  const {
    param,
    did,
    weight,
    only,
    voices: listed,
  } = (options ?? {}) as {
    param?: unknown;
    did?: unknown;
    weight?: unknown;
    only?: unknown;
    voices?: unknown;
  };
  const weights = parseWeights(param);
  if (typeof only === 'string' && only) {
    const dids = (Array.isArray(listed) ? listed : []).map((entry) =>
      typeof entry === 'string' ? entry : (entry as { did?: unknown })?.did,
    );
    for (const other of dids) if (typeof other === 'string' && other) weights.set(other, 0);
    weights.delete(only);
  } else if (typeof did === 'string' && did) {
    const share = Math.min(100, Math.max(0, Math.round(Number(weight))));
    if (!Number.isFinite(share) || share >= 100) weights.delete(did);
    else weights.set(did, share / 100);
  }
  return [...weights].map(([who, share]) => `${who}=${Math.round(share * 100)}`).join(',');
}
