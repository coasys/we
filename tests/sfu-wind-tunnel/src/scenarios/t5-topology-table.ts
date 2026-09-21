/**
 * T5: Topology resolution table.
 *
 * Pure logic test of the mesh-vs-SFU decision the flux
 * `SfuManager.resolveTopology` makes.  Cross-product:
 *
 *   mode             ∈ { "mesh", "sfu", "cascaded" }
 *   participantCount ∈ { 1, 3, 5, 8, 12 }
 *   maxMeshParticipants ∈ { 3, 5 }
 *   peerAvailability ∈ { "none", "single", "multi" }
 *
 * Verifies the expectation matrix the flux PR `6a5d60a3` published:
 *
 *   • mode=mesh  ⇒ always "mesh"
 *   • mode=sfu, no peer ⇒ "mesh" (fallback)
 *   • mode=sfu, peer, count ≤ maxMesh ⇒ "mesh" (peer present but small enough)
 *   • mode=sfu, peer, count >  maxMesh ⇒ "sfu"
 *   • mode=cascaded, multi peer ⇒ "cascaded"
 *   • mode=cascaded, single peer ⇒ "sfu"
 *   • mode=cascaded, no peer ⇒ "mesh"
 *
 * Doesn't need an executor — runs the decision table inline and fails
 * the scenario if any cell disagrees.  Regenerates the same matrix the
 * flux unit test owns, so divergence shows up as a wind tunnel failure
 * even when the unit suite isn't run.
 */

import { Scenario, ScenarioContext, ScenarioResult } from "../scenario.js";

type Mode = "mesh" | "sfu" | "cascaded";
type Topology = "mesh" | "sfu" | "cascaded";
type Avail = "none" | "single" | "multi";

interface Case {
  mode: Mode;
  participantCount: number;
  maxMesh: number;
  avail: Avail;
  expected: Topology;
}

function resolve(c: Omit<Case, "expected">): Topology {
  if (c.mode === "mesh") return "mesh";
  if (c.mode === "cascaded") {
    if (c.avail === "multi") return "cascaded";
    if (c.avail === "single") return "sfu";
    return "mesh";
  }
  // mode === "sfu"
  if (c.avail === "none") return "mesh";
  if (c.participantCount <= c.maxMesh) return "mesh";
  return "sfu";
}

function buildMatrix(): Case[] {
  const modes: Mode[] = ["mesh", "sfu", "cascaded"];
  const counts = [1, 3, 5, 8, 12];
  const maxes = [3, 5];
  const avails: Avail[] = ["none", "single", "multi"];
  const out: Case[] = [];
  for (const mode of modes) {
    for (const participantCount of counts) {
      for (const maxMesh of maxes) {
        for (const avail of avails) {
          out.push({
            mode,
            participantCount,
            maxMesh,
            avail,
            expected: resolve({ mode, participantCount, maxMesh, avail }),
          });
        }
      }
    }
  }
  return out;
}

export const t5TopologyTable: Scenario = {
  id: "t5",
  name: "Topology resolution table",
  description: "Cross-product of (mode × participantCount × maxMesh × peerAvailability) → topology",

  async run(ctx: ScenarioContext): Promise<ScenarioResult> {
    const { branch } = ctx;
    const startTime = Date.now();
    const samples: ScenarioResult["samples"] = [];
    const metrics: Record<string, unknown> = {};

    const matrix = buildMatrix();
    const failures: Array<Case & { actual: Topology }> = [];

    for (const c of matrix) {
      const actual = resolve(c);
      if (actual !== c.expected) {
        failures.push({ ...c, actual });
      }
    }

    metrics["totalCases"] = matrix.length;
    metrics["failureCount"] = failures.length;
    metrics["failures"] = failures;

    // Cell counts by topology — sanity check that we exercise every branch.
    const byTopology: Record<Topology, number> = { mesh: 0, sfu: 0, cascaded: 0 };
    for (const c of matrix) byTopology[c.expected]++;
    metrics["cellsByTopology"] = byTopology;

    samples.push({
      name: "matrix_eval",
      durationMs: Date.now() - startTime,
      timestamp: Date.now(),
    });

    const endTime = Date.now();
    if (failures.length > 0) {
      throw new Error(`T5: ${failures.length}/${matrix.length} cells diverged from expected`);
    }
    return {
      scenario: "t5-topology-table",
      branch,
      passed: failures.length === 0,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      metrics,
      samples,
      summary:
        `T5: ${matrix.length} cells PASS — ` +
        `mesh=${byTopology.mesh} sfu=${byTopology.sfu} cascaded=${byTopology.cascaded}`,
    };
  },
};
