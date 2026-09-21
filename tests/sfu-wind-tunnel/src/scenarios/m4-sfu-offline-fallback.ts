/**
 * M4: SFU offline at call-start.
 *
 * The room is configured `mode = "designated"` (single SFU peer) but
 * that peer is unavailable.  In the flux SfuManager the resolver
 * should fall back to mesh, and the scenario verifies that:
 *
 *   1. Pointing at a non-existent SFU peer surfaces a clean error
 *      from `sfu.callJoin` (NOT a hang).
 *   2. The mesh path is still operational — 3 hosts can pair up
 *      directly while the SFU is "offline".
 *
 * In single-binary form, "SFU offline" is simulated by calling
 * `sfu.callJoin` against a room that was never started — the SFU
 * service responds with a room-not-found error.  That's the same
 * shape flux's resolver sees when `sfuPeer` is null after a query.
 */

import { Scenario, ScenarioContext, ScenarioResult } from "../scenario.js";
import { MeshHost, connectAll } from "../mesh.js";

const NEIGHBOURHOOD = "windtunnel://m4-offline";
const NONEXISTENT_ROOM = "m4-room-never-started";

export const m4SfuOfflineFallback: Scenario = {
  id: "m4-sfu",
  name: "SFU offline → mesh fallback",
  description: "When designated SFU peer is unavailable, verify mesh fallback path still works",

  async run(ctx: ScenarioContext): Promise<ScenarioResult> {
    const { client, branch } = ctx;
    const startTime = Date.now();
    const samples: ScenarioResult["samples"] = [];
    const metrics: Record<string, unknown> = {};
    let passed = false;

    // Register the admin's DID as a neighbourhood member so the call
    // reaches the room-lookup path (not the membership gate).
    const agentStatus = await client.call<{ did: string }>("agent.status", {});
    await client.call("sfu.ensureMembership", {
      neighbourhoodUrl: NEIGHBOURHOOD,
      did: agentStatus.did,
    });

    // Step 1: confirm SFU correctly rejects a join to a never-started room.
    let rejectedCleanly = false;
    let rejectError: string | null = null;
    try {
      await client.call("sfu.callJoin", {
        neighbourhoodUrl: NEIGHBOURHOOD,
        roomName: NONEXISTENT_ROOM,
        sdpOffer: "{}",
      });
      // Should never reach here.
      rejectError = "unexpected success — sfu.callJoin on nonexistent room should fail";
    } catch (e) {
      rejectedCleanly = true;
      rejectError = e instanceof Error ? e.message : String(e);
    }
    metrics["sfuRejectedCleanly"] = rejectedCleanly;
    metrics["sfuRejectError"] = rejectError;

    // Step 2: mesh fallback for 3 hosts must work independently.
    const hosts = [
      new MeshHost("m4-a", { audioToneHz: 440 }),
      new MeshHost("m4-b", { audioToneHz: 540 }),
      new MeshHost("m4-c", { audioToneHz: 640 }),
    ];
    try {
      const pairWall = await connectAll(hosts);
      samples.push({ name: "mesh_fallback_paired", durationMs: pairWall, timestamp: Date.now() });
      metrics["meshPairWallMs"] = pairWall;

      await sleep(2000);
      hosts.forEach((h) => h.startStats());
      await sleep(8000);
      hosts.forEach((h) => h.stopStats());

      const uploads = hosts.map((h) => h.totalBytesSent());
      const losses = hosts.map((h) => h.totalPacketsLost());
      metrics["meshUploadBytesPerHost"] = uploads;
      metrics["meshPacketsLostPerHost"] = losses;
      metrics["meshAllConnected"] = uploads.every((b) => b > 0);
      passed = rejectedCleanly && uploads.every((b) => b > 0);
    } finally {
      await Promise.all(hosts.map((h) => h.close().catch(() => {})));
    }

    const endTime = Date.now();
    return {
      scenario: "m4-sfu-offline-fallback",
      branch,
      passed,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      metrics,
      samples,
      summary:
        `M4: SFU offline → mesh — sfuRejected=${metrics["sfuRejectedCleanly"]} ` +
        `meshAllConnected=${metrics["meshAllConnected"]}`,
    };
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
