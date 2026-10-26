#!/usr/bin/env node
/**
 * pnpm codemod:invoke [path …]
 *
 * Rewrites the handler token `$action` to `$invoke` in every tracked text file under the given paths
 * (the whole repository when none are given), and prints how many it changed in each file.
 *
 * A branch opened before the rename that adds templates, fragments or tests is rebased by running
 * this once and committing the result: the token's spelling is the only thing that changed, and
 * what a call passes is written in its `args` either way.
 *
 * Only the token is rewritten: `$action` as a whole word, wherever it is spelled — a key in a
 * template, a property read in code, a word in a comment or a doc. `$actions`, `${action}` and
 * `action` are other words and are left alone. A line carrying `invoke-codemod: keep` is left as it
 * is, for the few places that name the old token on purpose, such as the validator's message about
 * it; this script and its test are skipped whole.
 *
 * Run from the repository root.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdc|html)$/;
const TOKEN = /\$action\b/g; // invoke-codemod: keep
const KEEP = 'invoke-codemod: keep';

/** The text with the token rewritten, and how many times it was. Lines marked to keep are left. */
export function rewrite(text) {
  let count = 0;
  const out = text
    .split('\n')
    .map((line) => {
      if (line.includes(KEEP)) return line;
      return line.replace(TOKEN, () => {
        count += 1;
        return '$invoke';
      });
    })
    .join('\n');
  return { text: out, count };
}

function main(paths) {
  const files = execFileSync('git', ['ls-files', '-z', '--', ...(paths.length ? paths : ['.'])], {
    encoding: 'utf8',
  })
    .split('\0')
    // This script and its test name the old token on purpose throughout.
    .filter((file) => file && EXTENSIONS.test(file) && !file.startsWith('scripts/codemod-invoke'));
  let total = 0;
  for (const file of files) {
    const before = readFileSync(file, 'utf8');
    const { text, count } = rewrite(before);
    if (!count) continue;
    writeFileSync(file, text);
    total += count;
    console.log(`${String(count).padStart(5)}  ${file}`);
  }
  console.log(total ? `\nRewrote ${total} in ${files.length} files checked.` : 'Nothing to rewrite.');
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
