export type Props = Record<string, unknown>;
export type MapProp = { items: unknown; select: Props };
export type PickProp = { from: unknown; props: string[] };
export type IfProp = { condition: unknown; then: unknown; else?: unknown };
export type Memo = <T>(fn: () => T) => T;
export const noMemo: Memo = (fn) => fn();
