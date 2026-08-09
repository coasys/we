/**
 * Refuse to build a primitive whose `updated()` forgets `super.updated()`.
 *
 * The design system writes every one of its custom properties from the base class's `updated` —
 * `applyDSBehavior` in shared/design-system-element.ts. A primitive that overrides the hook for its
 * own imperative work and does not chain the call turns off `width`, `height`, `position` and the
 * rest **for that element alone**, with no error anywhere: the props are accepted, the properties
 * are set, the vars are never written, and the `var()` references in the generated stylesheet fall
 * back to `auto`.
 *
 * `we-video` shipped that way. The visible symptom was a call tile whose video sized itself from
 * the stream's own pixel dimensions — so a 720p camera and a 1080p screen capture laid out at
 * different widths, and both grew past a panel that had a perfectly definite height. It survived
 * review twice, because every explanation of the layout was about the layout.
 *
 * A build-time grep rather than a lint rule or a unit test: the package has no test runner, the
 * check needs no DOM, and the failure it catches is invisible at runtime by construction — which
 * is exactly the kind that has to be caught before it runs.
 */
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Lifecycle hooks whose base implementation does work that must not be skipped.
 *
 * `updated` and `connectedCallback` are the design system's own — the first writes the custom
 * properties, the second adopts the generated stylesheet. `disconnectedCallback` is Lit's, which
 * detaches reactive controllers.
 *
 * `firstUpdated` is deliberately absent: Lit's is empty and the design system does not override it,
 * so not chaining it costs nothing. Listing it would flag five primitives that are correct, and a
 * check that cries wolf is one people learn to run past.
 */
const CHAINED_HOOKS = ['updated', 'connectedCallback', 'disconnectedCallback'];

const ROOT = resolve(import.meta.dirname, '..');
const files = globSync('src/primitives/*.ts', { cwd: ROOT });

const problems = [];
for (const file of files) {
  const source = readFileSync(resolve(ROOT, file), 'utf-8');
  for (const hook of CHAINED_HOOKS) {
    // A method definition rather than a call: `updated(` at the start of a line, optionally
    // preceded by an access modifier. `this.updated(...)` and `changed.updated` do not match.
    const declares = new RegExp(`^\\s*(?:protected\\s+|public\\s+|private\\s+)?${hook}\\s*\\(`, 'm').test(source);
    if (declares && !source.includes(`super.${hook}(`)) {
      problems.push(`${file}: ${hook}() overrides the base implementation without calling super.${hook}()`);
    }
  }
}

if (problems.length) {
  console.error('\n[check-super-calls] Design system props will silently stop working:\n');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('\nChain the call — the base class writes the DS custom properties there.\n');
  process.exit(1);
}

console.log(`[check-super-calls] ${files.length} primitives checked, all lifecycle overrides chain.`);
