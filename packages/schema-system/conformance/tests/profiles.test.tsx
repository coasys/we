/**
 * profiles.json against WE's stores: every vector run again from the file alone — its world, its
 * address, its action — and what WE produces now compared with what the file says. Here, in the
 * solid project, because the stores need the browser build of solid-js and jsdom.
 *
 * A store action that stops telling its readers it changed, or changes the wrong thing, fails the
 * case naming it. So does a case edited in `src/cases/profiles.ts` without re-recording.
 */
import { CAPABILITY_PROFILES } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { runProfileCase, worldEntities } from '../../../app-shell/tests/support/profileHost.tsx';
import { PROFILE_CASES, PROFILE_WORLDS, profileWorldEntities } from '../src/cases/profiles';
import { profileRun, profileVectorInput, profileVectorOutcome, readProfileVectors } from '../src/profiles';

const file = readProfileVectors();

describe('profile vectors re-record to the committed content', () => {
  it('holds every case and world, each as written', () => {
    expect(file.cases.map(profileVectorInput)).toEqual(JSON.parse(JSON.stringify(PROFILE_CASES)));
    expect(file.worlds).toEqual(JSON.parse(JSON.stringify(PROFILE_WORLDS)));
  });

  it('names each profile at the version it defines, and the record types its worlds hold', () => {
    expect(file.profiles).toEqual(Object.fromEntries(CAPABILITY_PROFILES.map((p) => [p.id, p.version])));
    expect(file.entities).toEqual(worldEntities(profileWorldEntities()));
  });

  for (const vector of file.cases) {
    it(
      vector.id,
      async () => {
        expect(await runProfileCase(profileRun(profileVectorInput(vector), file.worlds))).toEqual(
          profileVectorOutcome(vector),
        );
      },
      30_000,
    );
  }
});
