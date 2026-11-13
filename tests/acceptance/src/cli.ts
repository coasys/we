/**
 * `pnpm --filter @we/acceptance acceptance [--host electron|tauri] [--only <id>…] [--list] [--out <dir>]`
 *
 * Runs the registered scenarios against one desktop app, Electron unless `--host tauri`, in local worlds and writes the report to `results/<time>/`. It runs
 * itself in a D-Bus session of its own (`session.ts`) and starts its own X display. Exits 1 when a
 * scenario failed, 0 otherwise: a pending scenario is reported and does not fail the run.
 */
import { join } from 'node:path';

import { runScenarios } from './runner.ts';
import { SCENARIOS } from './scenarios/index.ts';
import { inSession } from './session.ts';
import { type Host, HOSTS, pinnedAd4mCommit, resolveCheckout, WE_ROOT } from './world/checkout.ts';

function args(argv: string[]) {
  const only: string[] = [];
  let list = false;
  let host: Host = 'electron';
  let out = join(WE_ROOT, 'tests/acceptance/results', new Date().toISOString().replace(/[:.]/g, '-'));
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only') only.push(argv[++i]);
    else if (a === '--list') list = true;
    else if (a === '--host') {
      const named = argv[++i];
      if (!HOSTS.includes(named as Host)) throw new Error(`--host is one of ${HOSTS.join(', ')}`);
      host = named as Host;
    } else if (a === '--out') out = argv[++i];
    else if (a === '--') continue;
    else throw new Error(`unknown argument ${a}`);
  }
  return { only, list, out, host };
}

async function main() {
  const { only, list, out, host } = args(process.argv.slice(2));
  if (list) {
    for (const s of SCENARIOS) {
      const state = s.state.state === 'pending' ? `pending: ${s.state.reason}` : 'on';
      console.log(`${s.meta.id.padEnd(28)} ${state}\n${''.padEnd(28)} ${s.meta.title}`);
    }
    return;
  }
  const unknown = only.filter((id) => !SCENARIOS.some((s) => s.meta.id === id));
  if (unknown.length) throw new Error(`no scenario ${unknown.join(', ')}; --list names them`);
  const chosen = only.length ? SCENARIOS.filter((s) => only.includes(s.meta.id)) : SCENARIOS;
  if (!(await inSession())) return;

  const checkout = resolveCheckout(host);
  const pinned = pinnedAd4mCommit();
  console.log(`ad4m ${checkout.ad4mCommit} (WE pins ${pinned ?? 'unknown'}) from ${checkout.ad4m}`);
  console.log(`app ${checkout.host} ${checkout.app}`);
  console.log(`report ${out}`);
  const summary = await runScenarios(chosen, {
    checkout,
    out,
    onResult: (r) =>
      console.log(`${r.outcome.toUpperCase().padEnd(8)} ${r.id}${r.reason ? ` — ${r.reason.split('\n')[0]}` : ''}`),
  });
  console.log(
    `\n${summary.passed} passed · ${summary.failed} failed · ${summary.pending} pending · ${join(out, 'summary.md')}`,
  );
  process.exitCode = summary.failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 2;
});
