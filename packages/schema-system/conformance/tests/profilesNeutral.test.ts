/**
 * profiles.json again, on WE's stores with no framework under them: composed by the same
 * `composeStores` the app calls, on the test reactivity port (sibling effects shuffled, equal
 * writes waking) and the test platform, in the node project — no Solid, no jsdom, no window. Every
 * vector the app's own host passes (`profiles.test.tsx`) passes here, so what the file pins is the
 * stores' behaviour and not Solid's or the browser's. A picture is stored through the test
 * platform's image codec, which keeps the bytes as they came.
 */
import { describe, expect, it } from 'vitest';

import { neutralProfileHost, runProfileCase } from '../../../app-shell/tests/support/profileHost.ts';
import { profileRun, profileVectorInput, profileVectorOutcome, readProfileVectors } from '../src/profiles';

const file = readProfileVectors();

describe('profile vectors on the stores alone', () => {
  for (const vector of file.cases) {
    it(
      vector.id,
      async () => {
        expect(await runProfileCase(profileRun(profileVectorInput(vector), file.worlds), neutralProfileHost)).toEqual(
          profileVectorOutcome(vector),
        );
      },
      30_000,
    );
  }
});
