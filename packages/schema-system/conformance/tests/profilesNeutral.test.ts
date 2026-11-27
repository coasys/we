/**
 * profiles.json again, on WE's stores with no framework under them: composed by the same
 * `composeStores` the app calls, on the test reactivity port (sibling effects shuffled, equal
 * writes waking) and the test platform, in the node project — no Solid, no jsdom, no window. Every
 * vector the app's own host passes (`profiles.test.tsx`) passes here, so what the file pins is the
 * stores' behaviour and not Solid's or the browser's.
 */
import { describe, expect, it } from 'vitest';

import { neutralProfileHost, runProfileCase } from '../../../app-shell/tests/support/profileHost.ts';
import { profileRun, profileVectorInput, profileVectorOutcome, readProfileVectors } from '../src/profiles';

const file = readProfileVectors();

/*
  What this host cannot run yet, and why. Run inverted, so each is still failing for the reason
  given: the day one passes, it fails here and leaves the list.

  Storing an image compresses it first, and the compression (`compressImageToFileData` in
  @we/entities) reads the file and draws it with the browser's FileReader, Image and canvas, beneath
  the platform port — so a host with no DOM cannot set a space's picture.
*/
const KNOWN_GAPS: Record<string, RegExp> = {
  'space-settings.update-avatar': /FileReader is not defined/,
  'space-settings.update-cover-image': /FileReader is not defined/,
};

describe('profile vectors on the stores alone', () => {
  for (const vector of file.cases) {
    const gap = KNOWN_GAPS[vector.id];
    if (gap) {
      it(`${vector.id} (a known gap: needs the browser's image encoder)`, async () => {
        await expect(
          runProfileCase(profileRun(profileVectorInput(vector), file.worlds), neutralProfileHost),
        ).rejects.toThrow(gap);
      });
      continue;
    }
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
