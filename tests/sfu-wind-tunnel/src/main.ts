/**
 * WE SFU Wind Tunnel — Runner
 *
 * Runs topology-decision and mid-call transition scenarios.
 * Moved from coasys/ad4m-wind-tunnel during consolidation.
 */

import { existsSync, rmSync } from "fs";
import { join } from "path";
import { InstrumentedClient } from "./client.js";
import { buildExecutor, startExecutor, waitForHealth, stopExecutor, sleep, ExecutorConfig } from "./executor.js";
import { Scenario, ScenarioContext, ScenarioResult } from "./scenario.js";
import {
  t5TopologyTable,
  m1MeshToSfu, m2SfuToMesh, m4SfuOfflineFallback,
} from "./scenarios/index.js";
import { consoleReport, jsonReport } from "./reporters.js";
import { config, validateAdamRepo } from "./config.js";

const ALL_SCENARIOS: Scenario[] = [
  t5TopologyTable,
  m1MeshToSfu, m2SfuToMesh, m4SfuOfflineFallback,
];

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    scenarios: [] as string[],
    branches: [] as string[],
    skipBuild: false,
    executorPath: undefined as string | undefined,
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--scenario": result.scenarios.push(args[++i]); break;
      case "--branch": result.branches.push(args[++i]); break;
      case "--skip-build": result.skipBuild = true; break;
      case "--executor-path": result.executorPath = args[++i]; break;
    }
  }
  return result;
}

function branchToDirName(branch: string): string {
  return branch.replace(/\//g, "-");
}

async function runScenariosForBranch(
  branch: string,
  scenarios: Scenario[],
  binaryPath: string,
  port: number
): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  const dirName = branchToDirName(branch);

  for (const scenario of scenarios) {
    console.log(`\n[runner] Running ${scenario.id}: ${scenario.name} on ${branch}...`);

    const dataPath = join(config.tmpDirBase, `we-sfu-wt-data-${dirName}-${scenario.id}`);
    const config_: ExecutorConfig = {
      branch, port, dataPath,
      adminToken: config.adminToken,
      adamRepoPath: config.adamRepoPath,
      buildDir: join(config.tmpDirBase, `ad4m-build-${dirName}`),
    };

    let proc: any = null;

    try {
      proc = await startExecutor(binaryPath, config_);
      const healthWaitMs = await waitForHealth(port, 120000, config.adminToken);
      console.log(`[runner] Executor healthy after ${healthWaitMs.toFixed(0)}ms`);

      const client = new InstrumentedClient({ port, adminToken: config.adminToken });
      await client.connect();

      try {
        await client.call("agent.generate", { passphrase: "wind-tunnel-test" });
      } catch (err: any) {
        if (!err.message?.includes("already")) {
          console.log(`[runner] agent.generate: ${err.message}`);
        }
      }

      const ctx: ScenarioContext = {
        client, branch, port,
        adminToken: config.adminToken,
        adamRepoPath: config.adamRepoPath,
        tmpDirBase: config.tmpDirBase,
        executorPath: binaryPath,
      };

      try {
        const result = await scenario.run(ctx);
        results.push(result);
        console.log(`[runner] ${scenario.id} ${result.passed ? "PASS" : "FAIL"}: ${result.summary}`);
      } catch (err: any) {
        console.error(`[runner] ${scenario.id} CRASHED: ${err.message}`);
        results.push({
          scenario: `${scenario.id}-${scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}`,
          branch, passed: false, startTime: Date.now(), endTime: Date.now(), durationMs: 0,
          metrics: { error: err.message }, samples: [], summary: `CRASHED: ${err.message}`,
        });
      } finally {
        await client.disconnect();
      }
    } catch (err: any) {
      console.error(`[runner] Failed to start executor for ${scenario.id}: ${err.message}`);
      results.push({
        scenario: `${scenario.id}-${scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "")}`,
        branch, passed: false, startTime: Date.now(), endTime: Date.now(), durationMs: 0,
        metrics: { error: `Executor start failed: ${err.message}` }, samples: [],
        summary: `EXECUTOR FAILED: ${err.message}`,
      });
    } finally {
      if (proc) stopExecutor(proc);
      await sleep(2000);
      const dp = join(config.tmpDirBase, `we-sfu-wt-data-${dirName}-${scenario.id}`);
      if (existsSync(dp)) rmSync(dp, { recursive: true, force: true });
    }
  }

  return results;
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║      WE SFU WIND TUNNEL — Topology & Transition Testing    ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  const scenarios = args.scenarios.length > 0
    ? ALL_SCENARIOS.filter((s) => args.scenarios.includes(s.id))
    : ALL_SCENARIOS;

  const branches = args.branches.length > 0 ? args.branches : ["default"];

  console.log(`Scenarios: ${scenarios.map((s) => s.id).join(", ")}`);

  const binaryPaths = new Map<string, string>();
  if (args.executorPath) {
    for (const b of branches) binaryPaths.set(b, args.executorPath);
  } else if (args.skipBuild) {
    for (const b of branches) {
      const path = join(config.tmpDirBase, `ad4m-build-${branchToDirName(b)}`, "target", "release", "ad4m-executor");
      if (existsSync(path)) binaryPaths.set(b, path);
      else { console.error(`[runner] No binary for ${b} at ${path}`); process.exit(1); }
    }
  } else {
    validateAdamRepo();
    for (const b of branches) {
      const buildDir = join(config.tmpDirBase, `ad4m-build-${branchToDirName(b)}`);
      const start = performance.now();
      try {
        const path = await buildExecutor({
          branch: b, port: config.basePort, dataPath: "",
          adminToken: config.adminToken, adamRepoPath: config.adamRepoPath, buildDir,
        });
        console.log(`[build] ${b} built in ${((performance.now() - start) / 1000).toFixed(0)}s`);
        binaryPaths.set(b, path);
      } catch (err: any) {
        console.error(`[build] FAILED ${b}: ${err.message}`);
      }
    }
  }

  if (binaryPaths.size === 0) { console.error("[runner] No executors available."); process.exit(1); }

  const resultsDir = config.resultsDir;
  let totalPassed = 0, totalFailed = 0;

  for (const branch of branches) {
    const binaryPath = binaryPaths.get(branch);
    if (!binaryPath) continue;

    const port = config.basePort;
    const dirName = branchToDirName(branch);

    const results = await runScenariosForBranch(branch, scenarios, binaryPath, port);
    jsonReport(results, join(resultsDir, dirName));
    consoleReport(results);

    for (const r of results) { if (r.passed) totalPassed++; else totalFailed++; }
  }

  console.log(`\n[runner] Done — ${totalPassed} passed, ${totalFailed} failed.`);
  if (totalFailed > 0) process.exit(1);
}

main().catch((err) => { console.error("Fatal error:", err); process.exit(1); });
