import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No built-in `filter()` or `find()` counts on an absent value matching.
 *
 * The where-object now means in `filter()` what it means in a `$query`: a missing value matches no
 * comparison but `exists`. A where written against the old answer loses rows without any error, so
 * the audit is a gate rather than a script somebody remembers to run — and it is proved on a planted
 * file first, because an audit that finds nothing is only worth something if it can find something.
 *
 * Runs the CLI rather than re-implementing it, as `roleAudit.test.ts` does: the audit imports each
 * schema and walks the composed tree.
 */
const cwd = join(__dirname, '..');

function audit(...roots: string[]): { code: number; out: string } {
  try {
    const out = execFileSync('npx', ['tsx', 'src/cli/absent-audit.ts', ...roots], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string };
    return { code: e.status ?? 1, out: e.stdout ?? String(err) };
  }
}

describe('wheres that count on an absent value matching', () => {
  it('are found when planted, and the same wheres written for it are not', () => {
    const { code, out } = audit('tests/fixtures/absentAudit/planted.ts');
    expect(code).toBe(1);
    for (const field of ['plantedAssignee', 'plantedStatus', 'plantedTitle', 'plantedName', 'plantedNested']) {
      expect(out, field).toContain(`${field}:`);
    }
    expect(out).not.toMatch(/fixed[A-Z]\w*:/);
    expect(out).toContain('5 wheres that may count on an absent value matching.');
  });

  it('none remain in the composed templates and bundles', () => {
    const { code, out } = audit(
      '../../templates',
      '../../app-shell/src/shared/schemas',
      '../../module-system',
      '../../../bundles',
    );
    if (code !== 0) expect.fail(`\n${out}`);
  });
}, 60_000);
