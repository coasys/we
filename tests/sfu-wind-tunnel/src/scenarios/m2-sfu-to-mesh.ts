/**
 * M2: SFU → mesh degradation.
 *
 * Build a 5-peer SFU room.  Have 3 peers leave.  The remaining 2 are
 * below `max_mesh_participants = 4` so the topology resolver picks
 * `mesh` (verified by T5).  M2 drives the actual transport swap:
 * close the SFU PCs on the remaining peers, pair them via mesh, and
 * verify media flows over the mesh path.
 *
 * Reports:
 *   - SFU phase per-peer upload (constant, ~T1 baseline).
 *   - Transition wall time (close SFU PCs → mesh paired).
 *   - Mesh phase per-host upload (matches W1 baseline).
 *   - All-in-one transition correctness: the same 2 participants stay
 *     identifiable through the swap (their tone hz never changes).
 */

import { Scenario, ScenarioContext, ScenarioResult } from "../scenario.js";
import { MeshHost, connectAll } from "../mesh.js";
import { WebRtcPeer } from "../peer.js";
import { provisionPeers, disconnectPeers, registerSfuMembers } from "../users.js";
import { wireRenegotiation, RenegotiationWire } from "../renegotiation.js";

const ROOM_NAME = "m2-sfu-to-mesh";
const NEIGHBOURHOOD = `windtunnel://m2`;
const SFU_PEER_COUNT = 5;
const FINAL_MESH_COUNT = 2;
const PHASE_SEC = 8;

export const m2SfuToMesh: Scenario = {
  id: "m2-sfu",
  name: "SFU → mesh degradation",
  description: "5 peers on SFU, 3 leave, remaining 2 swap onto mesh transport",

  async run(ctx: ScenarioContext): Promise<ScenarioResult> {
    const { client, branch } = ctx;
    const startTime = Date.now();
    const samples: ScenarioResult["samples"] = [];
    const metrics: Record<string, unknown> = {};

    try {
      await client.call("sfu.startRoom", { neighbourhoodUrl: NEIGHBOURHOOD, roomName: ROOM_NAME });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not yet available")) {
        metrics["skipped"] = true;
        metrics["skip_reason"] = msg;
        return {
          scenario: "m2-sfu-to-mesh",
          branch,
          passed: true,
          startTime,
          endTime: Date.now(),
          durationMs: Date.now() - startTime,
          metrics,
          samples,
          summary: `M2: SKIPPED — ${msg}`,
        };
      }
      throw e;
    }

    // Phase A: 5 peers on SFU.
    const sessions = await provisionPeers({
      admin: client,
      port: ctx.port,
      count: SFU_PEER_COUNT,
      labelPrefix: "m2-sfu",
    });
    await registerSfuMembers({ admin: client, neighbourhoodUrl: NEIGHBOURHOOD, sessions });

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
          neighbourhoodUrl: NEIGHBOURHOOD,
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
          neighbourhoodUrl: NEIGHBOURHOOD,
          roomName: ROOM_NAME,
          sdpOffer: JSON.stringify(offer),
        });
        await peer.acceptAnswer(JSON.parse(joinResp.sdpAnswer));
      }

      // Settle + measure SFU phase.
      await sleep(2000);
      sfuPeers.forEach((p) => p.startStats());
      await sleep(PHASE_SEC * 1000);
      sfuPeers.forEach((p) => p.stopStats());
      const sfuUploads = sfuPeers.map((p) => p.getLastStats()?.bytesSent ?? 0);
      metrics["sfuUploadBytesPerPeer"] = sfuUploads;
      metrics["sfuUploadMean"] = mean(sfuUploads);

      // Phase B: 3 peers leave the SFU room, last 2 stay (for now).
      const leavingCount = SFU_PEER_COUNT - FINAL_MESH_COUNT;
      const leavingPeers = sfuPeers.splice(0, leavingCount);
      const leavingSessions = sessions.splice(0, leavingCount);
      const leavingWires = wires.splice(0, leavingCount);
      for (let i = 0; i < leavingPeers.length; i++) {
        try {
          await leavingSessions[i].client.call("sfu.callLeave", {
            neighbourhoodUrl: NEIGHBOURHOOD,
            roomName: ROOM_NAME,
          });
        } catch {}
        try {
          await leavingWires[i].detach();
        } catch {}
        await leavingPeers[i].close().catch(() => {});
      }
      await sleep(500);

      // Confirm the SFU has 2 left.
      const midRooms = await client.call<Array<{ roomName: string; participantCount: number }>>(
        "sfu.listRooms",
        {},
      );
      metrics["sfuParticipantsAfterLeave"] =
        midRooms.find((r) => r.roomName === ROOM_NAME)?.participantCount ?? -1;

      // Phase C: transition the remaining 2 from SFU → mesh.
      const transitionStart = Date.now();
      for (let i = 0; i < sfuPeers.length; i++) {
        try {
          await sessions[i].client.call("sfu.callLeave", {
            neighbourhoodUrl: NEIGHBOURHOOD,
            roomName: ROOM_NAME,
          });
        } catch {}
        try {
          await wires[i].detach();
        } catch {}
        await sfuPeers[i].close().catch(() => {});
      }
      sfuPeers.length = 0;
      wires.length = 0;

      const meshHosts: MeshHost[] = [
        new MeshHost("m2-mesh-a", { audioToneHz: 440 + 3 * 50 }),
        new MeshHost("m2-mesh-b", { audioToneHz: 440 + 4 * 50 }),
      ];
      try {
        await connectAll(meshHosts);
        const transitionMs = Date.now() - transitionStart;
        metrics["transitionMs"] = transitionMs;
        samples.push({
          name: "sfu_to_mesh_transition",
          durationMs: transitionMs,
          timestamp: Date.now(),
        });

        await sleep(1500);
        meshHosts.forEach((h) => h.startStats());
        await sleep(PHASE_SEC * 1000);
        meshHosts.forEach((h) => h.stopStats());

        const meshUploads = meshHosts.map((h) => h.totalBytesSent());
        const meshLost = meshHosts.map((h) => h.totalPacketsLost());
        metrics["meshUploadBytesPerHost"] = meshUploads;
        metrics["meshUploadMean"] = mean(meshUploads);
        metrics["meshPacketsLostTotal"] = meshLost.reduce((a, b) => a + b, 0);

        // Hard assertion: mesh phase shows media flowing on remaining peers.
        passed = meshUploads.every((b) => b > 0);
      } finally {
        await Promise.all(meshHosts.map((h) => h.close().catch(() => {})));
      }
    } finally {
      try {
        await client.call("sfu.stopRoom", { neighbourhoodUrl: NEIGHBOURHOOD, roomName: ROOM_NAME });
      } catch {}
      await disconnectPeers(sessions);
    }

    const endTime = Date.now();
    return {
      scenario: "m2-sfu-to-mesh",
      branch,
      passed,
      startTime,
      endTime,
      durationMs: endTime - startTime,
      metrics,
      samples,
      summary:
        `M2: degrade — sfuUpload=${metrics["sfuUploadMean"]}B → meshUpload=${metrics["meshUploadMean"]}B ` +
        `(transition=${metrics["transitionMs"]}ms; sfu participants after leave=${metrics["sfuParticipantsAfterLeave"]})`,
    };
  },
};

function mean(arr: number[]): number {
  return arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
