import { isExpressionToken, parseExpression, referencedPaths } from '@we/expressions';

import { HOST_ONLY_EQUIVALENTS } from './equivalents';
import { NEUTRAL_NAMESPACES, PROFILE_MEMBERS } from './lookup';

/** One store member a template names that no profile holds, and how often it names it. */
export interface HostOnlyUse {
  /** `store.member` — only the first two segments of the path written. */
  member: string;
  count: number;
  /** What to write instead, where a neutral equivalent exists. */
  equivalent?: string;
}

/**
 * Every store member a schema names, read in an expression, called through `$invoke` or given as a
 * query's dataset, that is outside every capability profile — counted, most used first.
 *
 * `members` is the host's store members by store, so only a member the host actually has counts: a
 * root an expression binds itself (`item`, `local`, a `$each` name) is not a store, a member nobody
 * has is the unknown-member check's to report, and a store a schema declares for itself in
 * `meta.stores` is its own, not the host's. A reference that does not parse names nothing, as it
 * resolves to nothing at paint; the validator reports the syntax error elsewhere.
 */
export function hostOnlyUses(schema: unknown, members: ReadonlyMap<string, ReadonlySet<string>>): HostOnlyUse[] {
  const counts = new Map<string, number>();
  const note = (path: string) => {
    const [store, member] = path.split('.');
    if (!store || !member || NEUTRAL_NAMESPACES.has(store) || !members.get(store)?.has(member)) return;
    const key = `${store}.${member}`;
    if (PROFILE_MEMBERS.has(key)) return;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (typeof node.$invoke === 'string') note(node.$invoke);
    if (isExpressionToken(node)) {
      try {
        for (const { root, path } of referencedPaths(parseExpression(node.$))) {
          if (path.length > 0) note([root, ...path].join('.'));
        }
      } catch {
        // A syntax error is reported by the expression check.
      }
    }
    if (typeof node.entity === 'string' && typeof node.dataset === 'string') note(node.dataset);
    for (const entry of Object.values(node)) walk(entry);
  };
  walk(schema);

  return [...counts]
    .map(([member, count]) => ({
      member,
      count,
      ...(HOST_ONLY_EQUIVALENTS[member] ? { equivalent: HOST_ONLY_EQUIVALENTS[member] } : {}),
    }))
    .sort((a, b) => b.count - a.count || a.member.localeCompare(b.member));
}

/**
 * The one line a validator reports for a schema's WE-host-only uses: how many, then those with a
 * neutral equivalent and what it is, then the rest. One line per schema rather than one per use,
 * because a host's own chrome uses hundreds and they are advice, not faults.
 */
export function describeHostOnly(uses: readonly HostOnlyUse[]): string {
  const total = uses.reduce((sum, use) => sum + use.count, 0);
  const times = (use: HostOnlyUse) => (use.count > 1 ? ` ×${use.count}` : '');
  const movable = uses.filter((use) => use.equivalent);
  const rest = uses.filter((use) => !use.equivalent);
  const parts = [
    `WE-host-only: ${total} use${total === 1 ? '' : 's'} of ${uses.length} store member${uses.length === 1 ? '' : 's'} outside every capability profile.`,
  ];
  if (movable.length)
    parts.push(
      `With a neutral equivalent: ${movable.map((use) => `${use.member}${times(use)} → ${use.equivalent}`).join('; ')}.`,
    );
  if (rest.length)
    parts.push(
      `${movable.length ? 'The rest' : 'None has one yet'}: ${rest.map((use) => `${use.member}${times(use)}`).join(', ')}.`,
    );
  return parts.join(' ');
}
