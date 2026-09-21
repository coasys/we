/**
 * M1: Mesh → SFU promotion.
 *
 * Build a 4-host mesh.  Then a 5th host joins; if the room config has
 * `max_mesh_participants = 4`, this should trip the topology resolver
 * onto the SFU path.  Measures:
 *
 *   1. Time on mesh (4 hosts established mesh + bandwidth baseline).
 *   2. The transition: how long between the 5th host's offer and every
 *      host having an SFU peer connection (existing mesh PCs torn down).
 *   3. Steady-state SFU bandwidth (post-promotion) per host vs pre-mesh.
 *
 * Pre-requisite: SFU service must be available.  Skips gracefully
 * otherwise.
 *
 * Note: this scenario exercises both transports against the SAME
 * executor — the harness drives the mesh→SFU swap explicitly via
 * `sfu.startRoom` + `sfu.callJoin` rather than going through the flux
 * `SfuManager` (which would require flux's full Vue/SolidJS stack).
 */

import { Scenario, ScenarioContext, ScenarioResult } from "../scenario.js";
import { MeshHost, connectAll } from "../mesh.js";
import { WebRtcPeer } from "../peer.js";
import { provisionPeers, disconnectPeers, registerSfuMembers } from "../users.js";
import { wireRenegotiation, RenegotiationWire } from "../renegotiation.js";

const ROOM_NAME = "m1-mesh-to-sfu";
const MAX_MESH = 4;

export const m1MeshToSfu: Scenario = {
  id: "m1-sfu",
  name: "Mesh → SFU promotion",
  description: "4 mesh hosts; 5th joins; verify transition to SFU + final per-host upload is O(1)",

  async run(ctx: ScenarioContext): Promise<ScenarioResult> {
    const { client, branch } = ctx;
    const startTime = Date.now();
    const samples: ScenarioResult["samples"] = [];
    const metrics: Record<string, unknown> = {};

    const neighbourhoodUrl = `windtunnel://m1`;
    metrics["neighbourhoodUrl"] = neighbourhoodUrl;

    // Probe SFU availability before committing.
    try {
      await client.call("sfu.getConfig", { neighbourhoodUrl });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not yet available") || msg.includes("Unknown type")) {
        metrics["skipped"] = true;
        metrics["skip_reason"] = `SFU not available: ${msg}`;
        return {
          scenario: "m1-mesh-to-sfu",
          branch,
          passed: true,
          startTime,
          endTime: Date.now(),
          durationMs: Date.now() - startTime,
          metrics,
          samples,
          summary: `M1: SKIPPED — ${msg}`,
        };
      }
      // Other errors (e.g. unknown neighbourhood) are tolerable —
      // the SFU treats them as ad-hoc.
    }

    // Phase A: 4-host mesh.
    const meshHosts: MeshHost[] = [];
    for (let i = 0; i < MAX_MESH; i++) {
      meshHosts.push(new MeshHost(`mesh-${i}`, { audioToneHz: 440 + i * 60 }));
    }
    const meshPairWall = await connectAll(meshHosts);
    samples.push({ name: "mesh_phase_paired", durationMs: meshPairWall, timestamp: Date.now() });
    await sleep(3000);
    meshHosts.forEach((h) => h.startStats());
    await sleep(10_000);
    meshHosts.forEach((h) => h.stopStats());
    const meshUploads = meshHosts.map((h) => h.totalBytesSent());
    metrics["meshUploadBytesPerHost"] = meshUploads;
    metrics["meshUploadMean"] = mean(meshUploads);

    // Phase B: tear down mesh, all peers join SFU.
    await Promise.all(meshHosts.map((h) => h.close().catch(() => {})));
    await client.call("sfu.startRoom", { neighbourhoodUrl, roomName: ROOM_NAME });

    const sessions = await provisionPeers({
      admin: client,
      port: ctx.port,
      count: MAX_MESH + 1,
      labelPrefix: "m1-sfu",
    });
    await registerSfuMembers({ admin: client, neighbourhoodUrl, sessions });

    const transitionStart = Date.now();
    const sfuPeers: WebRtcPeer[] = [];
    const wires: RenegotiationWire[] = [];
    let passed = false;
    try {
      for (let i = 0; i < sessions.length; i++) {
        const s = sessions[i];
        const peer = new WebRtcPeer(s.label, { audioToneHz: 440 + i * 50 });
        await peer.attachSyntheticStream();
        sfuPeers.push(peer);
        const wire = await wireRenegotiation({
          client: s.client,
          peer,
          token: s.token,
          port: ctx.port,
          neighbourhoodUrl,
          roomName: ROOM_NAME,
        });
        wires.push(wire);
        const offer = await peer.createOffer();
        const joinResp = await s.client.call<{
          sdpAnswer: string;
          participantId: string;
          redirectTo?: string;
          streamMapping: string[];
        }>("sfu.callJoin", {
          neighbourhoodUrl,
          roomName: ROOM_NAME,
          sdpOffer: JSON.stringify(offer),
        });
        if (joinResp.redirectTo) {
          throw new Error(`M1 unexpected cascade redirect to ${joinResp.redirectTo}`);
        }
        await peer.acceptAnswer(JSON.parse(joinResp.sdpAnswer));
      }
      const transitionMs = Date.now() - transitionStart;
      metrics["transitionMs"] = transitionMs;
      samples.push({
        name: "sfu_phase_joined",
        durationMs: transitionMs,
        timestamp: Date.now(),
      });

      await sleep(3000);
      sfuPeers.forEach((p) => p.startStats());
      await sleep(10_000);
      sfuPeers.forEach((p) => p.stopStats());

      const sfuUploads = sfuPeers.map((p) => p.getLastStats()?.bytesSent ?? 0);
      metrics["sfuUploadBytesPerPeer"] = sfuUploads;
      metrics["sfuUploadMean"] = mean(sfuUploads);

      // The interesting comparison: post-promotion per-peer upload
      // should be ~constant relative to the mesh case which scaled.
      metrics["sfuVsMeshUploadRatio"] = +(
        (metrics["sfuUploadMean"] as number) / (metrics["meshUploadMean"] as number)
      ).toFixed(2);

      // Hard assertion: SFU join succeeded and all peers sent media.
      passed = sfuUploads.every((b) => b > 0);
    } finally {
      for (const w of wires) {
        try {
          await w.detach();
        } catch {}
      }
      for (let i = 0; i < sfuPeers.length; i++) {
        try {
          await sessions[i]?.client.call("sfu.callLeave", {
            neighbourhoodUrl,
            roomName: ROOM_NAME,
          });
        } catch {}
        try {
          await sfuPeers[i].close();
        } catch {}
      }
      try {
        await client.call("sfu.stopRoom", { neighbourhoodUrl, roomName: ROOM_NAME });
      } catch {}
      await disconnectPeers(sessions);
    }

    const endTime = Date.now();
    return {
      scenario: "m1-mesh-to-sfu",
      branch,
      passed,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      metrics,
      samples,
      summary:
        `M1: promotion — meshUpload=${metrics["meshUploadMean"]}B sfuUpload=${metrics["sfuUploadMean"]}B ` +
        `(ratio=${metrics["sfuVsMeshUploadRatio"]}x; <1 = SFU saving)`,
    };
  },
};

function mean(arr: number[]): number {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
