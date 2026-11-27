/**
 * The capability-profile vector file: what it holds, and the step from a case to a vector and back.
 *
 * The cases are written in `cases/profiles.ts`; what each produces is recorded on WE's own stores by
 * `tests/record-profiles.test.tsx`, and `tests/profiles.test.tsx` runs every vector from the file
 * again and fails when WE no longer produces what it says.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProfileCaseInput, ProfileOutcome, ProfileWorld } from '../../../app-shell/tests/support/profileHost.tsx';
import type { ProfileCase } from './cases/profiles';

export const PROFILE_VECTORS_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors', 'profiles.json');

/** One vector: a case's input and what the host produced for it. */
export type ProfileVector = ProfileCase & ProfileOutcome;

export interface ProfileVectorFile {
  version: 1;
  /** Each profile the cases test, at the version they were recorded against. */
  profiles: Record<string, string>;
  /** The worlds the cases start from, by name. */
  worlds: Record<string, ProfileWorld>;
  /** The record types the worlds hold, with their properties. */
  entities: Record<string, { properties: Record<string, unknown> }>;
  cases: ProfileVector[];
}

/** A case and its outcome as the file lists them: the input first, in a fixed order. */
export function profileVectorOf(c: ProfileCase, outcome: ProfileOutcome): ProfileVector {
  const { id, profile, note, world, address, history, setup, observe, action, args } = c;
  return {
    id,
    profile,
    note,
    world,
    address,
    ...(history ? { history } : {}),
    ...(setup ? { setup } : {}),
    observe,
    ...(action ? { action, args: args ?? [] } : {}),
    ...outcome,
  };
}

/** What a vector asks of a host, without what it recorded. */
export function profileVectorInput(vector: ProfileVector): ProfileCase {
  const {
    state: _state,
    before: _before,
    after: _after,
    events: _events,
    ...input
  } = vector as ProfileVector & {
    state?: unknown;
    before?: unknown;
    after?: unknown;
    events?: unknown;
  };
  return input;
}

/** What a vector recorded, without what it asks. */
export function profileVectorOutcome(vector: ProfileVector): ProfileOutcome {
  const v = vector as Partial<Record<'state' | 'before' | 'after' | 'events', unknown>>;
  return ('state' in v ? { state: v.state } : { before: v.before, after: v.after, events: v.events }) as ProfileOutcome;
}

/** A case as a host runs it, its world looked up by name. */
export function profileRun(c: ProfileCase, worlds: Record<string, ProfileWorld>): ProfileCaseInput {
  const world = worlds[c.world];
  if (!world) throw new Error(`${c.id} starts from a world named "${c.world}", which the file does not hold`);
  return { ...c, world };
}

export function readProfileVectors(): ProfileVectorFile {
  return JSON.parse(readFileSync(PROFILE_VECTORS_FILE, 'utf8')) as ProfileVectorFile;
}

export type { ProfileCaseInput };
