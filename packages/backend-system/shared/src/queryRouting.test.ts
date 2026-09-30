/**
 * The decision every query in the app passes through.
 *
 * What is being checked here is the *branching* — run, refuse, or run and say so — against a stub
 * adapter, so each outcome is reachable without a backend. Whether the routed query returns the same
 * rows as the unrouted one is a different question, and it is asked where there is something to run:
 * `@we/backend-inmemory`'s `queryRouting.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { type AdapterCapabilities, type CapabilityGap, planQuery } from './queryCapabilities';
import type { QueryIR } from './queryIR';
import { routeQuery } from './queryRouting';

const full: AdapterCapabilities = {
  operators: ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in', 'nin', 'contains', 'startsWith', 'endsWith', 'exists'],
  booleanCombinators: true,
  relationFilters: true,
  scope: true,
  include: { supported: true },
  aggregate: ['count'],
  sort: { multiKey: true, byRelationPath: true, byAggregate: true },
  pagination: ['offset'],
  live: 'push',
};

/** Lowers to a marker rather than to anything real — these tests are about the decision, not the SQL. */
const adapterWith = (capabilities: AdapterCapabilities, extraGaps: CapabilityGap[] = []) => ({
  capabilities,
  plan: (ir: QueryIR) => {
    const plan = planQuery(ir, capabilities);
    return { ...plan, gaps: [...plan.gaps, ...extraGaps] };
  },
  lower: (ir: QueryIR) => ({ lowered: ir.entity }),
});

describe('a query the backend can answer', () => {
  it('lowers it and says nothing', () => {
    const routed = routeQuery({ entity: 'TestItem', where: { status: 'active' } }, adapterWith(full));

    expect(routed.ok).toBe(true);
    expect(routed.ok && routed.options).toEqual({ lowered: 'TestItem' });
    expect(routed.diagnostics).toEqual([]);
  });
});

describe('a query the backend cannot answer', () => {
  it('refuses, naming the capability rather than the query', () => {
    const noIncludes = { ...full, include: { supported: false } };
    const routed = routeQuery({ entity: 'TestItem', include: { children: true } }, adapterWith(noIncludes));

    expect(routed.ok).toBe(false);
    expect(routed.ok === false && routed.error).toContain('include');
    expect(routed.ok === false && routed.error).toContain('TestItem');
  });

  it('refuses a query the IR itself cannot express, and says that instead', () => {
    // `offset` without `limit` is the compiler's own refusal — nothing to do with the backend.
    const routed = routeQuery({ entity: 'TestItem', offset: 5 }, adapterWith(full));

    expect(routed.ok).toBe(false);
    expect(routed.ok === false && routed.error).toContain('query IR cannot express');
  });

  it('never falls back to handing the backend the raw dialect', () => {
    const noCombinators = { ...full, booleanCombinators: false };
    const routed = routeQuery(
      { entity: 'TestItem', where: { OR: [{ status: 'draft' }, { status: 'active' }] } },
      adapterWith(noCombinators),
    );

    // The point of the refusal: there is no third answer where the original options come back
    // unrouted. A caller gets options it can run, or a reason it cannot.
    expect(routed.ok).toBe(false);
    expect(routed).not.toHaveProperty('options');
  });
});

describe('a backend that runs the query but ignores one feature', () => {
  const degraded: CapabilityGap = {
    feature: 'sort:pushdown',
    path: 'sort',
    disposition: 'degraded',
    note: 'sort pushdown is dropped under an explicit OR',
  };

  it('proceeds — a backend defect must not block a working screen', () => {
    const routed = routeQuery({ entity: 'TestItem', order: { name: 'asc' } }, adapterWith(full, [degraded]));

    expect(routed.ok).toBe(true);
    expect(routed.ok && routed.options).toEqual({ lowered: 'TestItem' });
  });

  it('hands back a diagnostic naming the feature, so the waiver stays visible', () => {
    const routed = routeQuery({ entity: 'TestItem', order: { name: 'asc' } }, adapterWith(full, [degraded]));

    expect(routed.diagnostics).toEqual([
      { key: 'degraded:sort:pushdown', message: expect.stringContaining('sort pushdown is dropped') },
    ]);
  });

  it('keys the diagnostic without the entity, so a caller can dedupe per entity itself', () => {
    const one = routeQuery({ entity: 'TestItem' }, adapterWith(full, [degraded]));
    const other = routeQuery({ entity: 'TestChild' }, adapterWith(full, [degraded]));

    expect(one.diagnostics[0].key).toBe(other.diagnostics[0].key);
    expect(one.diagnostics[0].message).not.toBe(other.diagnostics[0].message);
  });

  it('blocks when a gap is real, even alongside a degradation', () => {
    const noIncludes = { ...full, include: { supported: false } };
    const routed = routeQuery({ entity: 'TestItem', include: { children: true } }, adapterWith(noIncludes, [degraded]));

    expect(routed.ok).toBe(false);
  });
});

describe('the query for the record with no id', () => {
  it('still runs — an empty id is a real value to the layers below', () => {
    const routed = routeQuery({ entity: 'TestItem', where: { id: '' } }, adapterWith(full));

    expect(routed.ok).toBe(true);
  });

  it('says so, because what reaches the screen otherwise is a SPARQL parse error', () => {
    const routed = routeQuery({ entity: 'TestItem', where: { id: '' } }, adapterWith(full));

    expect(routed.diagnostics).toContainEqual({ key: 'emptyId', message: expect.stringContaining('asks for id ""') });
  });

  it('reports it on a refusal too — the two are independent findings', () => {
    const noIncludes = { ...full, include: { supported: false } };
    const routed = routeQuery(
      { entity: 'TestItem', where: { id: '' }, include: { children: true } },
      adapterWith(noIncludes),
    );

    expect(routed.ok).toBe(false);
    expect(routed.diagnostics.map((d) => d.key)).toContain('emptyId');
  });

  it('leaves an ordinary id alone', () => {
    const routed = routeQuery({ entity: 'TestItem', where: { id: 'item-1' } }, adapterWith(full));

    expect(routed.diagnostics).toEqual([]);
  });
});

describe('an adapter that throws', () => {
  it('refuses rather than letting the error reach the render', () => {
    const exploding = {
      capabilities: full,
      plan: () => {
        throw new Error('adapter is confused');
      },
      lower: () => ({}),
    };
    const routed = routeQuery({ entity: 'TestItem' }, exploding);

    expect(routed.ok).toBe(false);
    expect(routed.ok === false && routed.error).toContain('adapter is confused');
  });
});
