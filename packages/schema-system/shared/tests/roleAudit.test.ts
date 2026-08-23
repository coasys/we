import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No template paints with a scale position where a role belongs.
 *
 * This is the enforcement half of the roles migration, and it was the missing half. The vocabulary
 * was right and the picker leads with roles, but `bg="neutral-100"` still typechecks, validates and
 * renders — and looks correct in whichever theme it was written in. Discipline was the only thing
 * standing between the migration and its own slow reversal, and 197 nodes had already drifted back
 * across the composed templates by the time anybody looked.
 *
 * Almost all of them came from four defaults rather than 197 decisions: `statChip`'s icon colour,
 * `attributeRow`'s, the rail's selected row, and a line of *guidance* recommending `neutral-300` for
 * a gate prompt that every gate prompt in the repo then copied. That is the shape of the problem —
 * a default in a shared fragment is reproduced everywhere it is used — and it is why this is a gate
 * rather than a script somebody remembers to run.
 *
 * Runs the CLI rather than re-implementing it: the audit has to *import* each schema and walk the
 * real composed tree, because a fragment contributed by another package is invisible to any grep
 * over the route that renders it. ~2s.
 */
describe('scale positions where a role belongs', () => {
  it('none remain in the composed templates', () => {
    const cwd = join(__dirname, '..');
    try {
      execFileSync(
        'npx',
        [
          'tsx',
          'src/cli/role-audit.ts',
          '../../templates',
          '../../app-shell/src/shared/schemas',
          '../../module-system',
        ],
        { cwd, encoding: 'utf8', stdio: 'pipe' },
      );
    } catch (err) {
      // The CLI exits 1 with the findings on stdout — that listing *is* the failure message.
      const out = (err as { stdout?: string }).stdout ?? String(err);
      expect.fail(`\n${out}\nUse a role, or add the file to PALETTES in role-audit.ts if it is a palette.`);
    }
  });
}, 60_000);
