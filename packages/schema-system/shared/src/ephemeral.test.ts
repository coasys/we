import { describe, expect, it } from 'vitest';

import { type EphemeralCapabilities, planEphemeral } from './ephemeral';

/** AD4M today: real unicast exists upstream but `sendSignalU` is broken, so the adapter emulates it. */
const ad4m: EphemeralCapabilities = {
  fanout: true,
  unicast: 'emulated',
  reliability: 'send-acked',
  heartbeatRequired: true,
  authenticatedSender: true,
};

/** A server-backed transport (Socket.io, Supabase Realtime): knows who is connected, routes directly. */
const server: EphemeralCapabilities = {
  fanout: true,
  unicast: 'native',
  reliability: 'at-least-once',
  heartbeatRequired: false,
  authenticatedSender: true,
};

/** Yjs awareness: fan-out only, no addressing at all. */
const awareness: EphemeralCapabilities = {
  fanout: true,
  unicast: 'none',
  reliability: 'best-effort',
  heartbeatRequired: true,
  authenticatedSender: false,
};

describe('planEphemeral', () => {
  it('lets presence run on every transport — it only needs fan-out', () => {
    const req = { consumer: 'presence' };
    for (const cap of [ad4m, server, awareness]) {
      expect(planEphemeral(req, cap).runnable).toBe(true);
    }
  });

  it('runs a call module on AD4M, where emulated addressing is good enough for SDP/ICE', () => {
    const plan = planEphemeral({ consumer: 'call module', unicast: 'emulated' }, ad4m);
    expect(plan).toEqual({ runnable: true, gaps: [] });
  });

  it('refuses a call module on a fan-out-only transport instead of hanging on the handshake', () => {
    const plan = planEphemeral({ consumer: 'call module', unicast: 'emulated' }, awareness);
    expect(plan.runnable).toBe(false);
    expect(plan.gaps[0].feature).toBe('unicast');
    expect(plan.gaps[0].note).toContain('call module');
  });

  it('treats native as satisfying a request for emulated, but not the reverse', () => {
    expect(planEphemeral({ consumer: 'c', unicast: 'emulated' }, server).runnable).toBe(true);
    expect(planEphemeral({ consumer: 'c', unicast: 'native' }, ad4m).runnable).toBe(false);
  });

  it('rejects confidential payloads over emulated addressing — addressing is not privacy', () => {
    const plan = planEphemeral({ consumer: 'private notes', unicast: 'emulated', confidential: true }, ad4m);
    expect(plan.runnable).toBe(false);
    expect(plan.gaps.map((g) => g.feature)).toContain('unicast:confidential');
    expect(plan.gaps.find((g) => g.feature === 'unicast:confidential')?.note).toContain('not privacy');
  });

  it('allows confidential payloads only over native unicast', () => {
    expect(planEphemeral({ consumer: 'private notes', confidential: true }, server).runnable).toBe(true);
  });

  it('refuses to act on sender identity when the sender is self-asserted', () => {
    const req = { consumer: 'work lease', requiresAuthenticatedSender: true };
    expect(planEphemeral(req, ad4m).runnable).toBe(true);
    const plan = planEphemeral(req, awareness);
    expect(plan.runnable).toBe(false);
    expect(plan.gaps[0].feature).toBe('authenticatedSender');
  });

  it('reports every unmet requirement at once, not just the first', () => {
    const plan = planEphemeral(
      { consumer: 'everything', unicast: 'native', confidential: true, requiresAuthenticatedSender: true },
      awareness,
    );
    expect(plan.gaps.map((g) => g.feature).sort()).toEqual(['authenticatedSender', 'unicast', 'unicast:confidential']);
  });
});
