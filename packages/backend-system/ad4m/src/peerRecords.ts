/**
 * Holochain's peer-discovery records, decoded for reading.
 *
 * `runtime.hcAgentInfos` returns each record as Kitsune2 encodes a signed agent info:
 *
 *     {"agentInfo":"{\"agent\":\"…\",\"space\":\"…\",\"createdAt\":\"1726…\",…}","signature":"…"}
 *
 * The part worth reading is a JSON document *inside a string*. That is deliberate on Kitsune's side
 * — the signature is over those exact bytes, so they travel as a string rather than being parsed and
 * re-serialized differently — and it means indenting the record as it arrives leaves the useful half
 * as one long escaped line. This unpacks it, and writes the two timestamps, which are microseconds
 * since the epoch as a string, as dates.
 *
 * Display only. The records handed back for copying are the originals, untouched: a reformatted
 * record would no longer match its signature, and the node it was pasted into would refuse it.
 */
import type { PeerRecords } from '@we/backend-shared';

import { toReadableJson } from './readableJson';

/**
 * Kitsune2's `Timestamp`, written by `serde_string_timestamp`: integer microseconds, as a string.
 * Well inside the range a double holds exactly, for any date this side of the year 2255.
 */
function microsToDate(value: unknown): unknown {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^-?\d+$/.test(text)) return value;
  const date = new Date(Math.trunc(Number(text) / 1000));
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function parseObject(text: unknown): Record<string, unknown> | undefined {
  if (typeof text !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One record, unpacked: the agent info's own fields first, then the signature.
 *
 * A record that is not in the expected shape is shown as the string it arrived as rather than
 * dropped — this screen exists for when something is wrong, which is when a record is most likely
 * to be malformed and most worth seeing.
 */
function decodeRecord(raw: string): unknown {
  const outer = parseObject(raw);
  const info = parseObject(outer?.agentInfo);
  if (!outer || !info) return raw;
  const { agent, space, createdAt, expiresAt, ...rest } = info;
  const decoded: Record<string, unknown> = {
    agent,
    space,
    createdAt: microsToDate(createdAt),
    expiresAt: microsToDate(expiresAt),
    ...rest,
    signature: outer.signature,
  };
  // A field this version of the record does not carry is left out rather than shown as null.
  return Object.fromEntries(Object.entries(decoded).filter(([, value]) => value !== undefined));
}

export function toPeerRecords(records: string[]): PeerRecords {
  return { records, readable: toReadableJson(records.map(decodeRecord)) };
}
