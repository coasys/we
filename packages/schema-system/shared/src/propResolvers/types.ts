export type Props = Record<string, unknown>;
export type Memo = <T>(fn: () => T) => T;
export const noMemo: Memo = (fn) => fn();
