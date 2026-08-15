export type Props = Record<string, unknown>;
export type MapProp = { items: unknown; select: Props };
export type PickProp = { from: unknown; props: string[] };
export type IfProp = { condition: unknown; then: unknown; else?: unknown };
export type ConcatProp = unknown[];
export type FilterProp = {
  items: unknown;
  where: Record<string, unknown>;
  /**
   * Keep only the first N matches.
   *
   * The companion to `where`, and the only way to say "the first few" — the operator set has no
   * arithmetic and no slice, so a view wanting two of a day's events and a "more" marker could
   * previously only render all of them and clip the overflow, which cuts a row through the middle
   * of whatever happened to be last.
   *
   * Resolved through the prop system like any other value, so it can come from `$local`.
   */
  limit?: unknown;
};
export type CountProp = { items: unknown };
export type FindProp = { items: unknown; where?: Record<string, unknown>; select?: string };
export type PluralProp = { count: unknown; one: string; other: string };
export type Memo = <T>(fn: () => T) => T;
export const noMemo: Memo = (fn) => fn();
