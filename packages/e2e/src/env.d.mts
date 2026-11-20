/** The repository's root. */
export const ROOT: string;

/** The executor binary `scripts/ad4m-executor.mjs --path` names; throws when it is not there. */
export function executorBinary(): string;

/** Where Chrome might be when `WE_CHROME` does not say, in the order they are tried. */
export function chromeCandidates(): string[];

/** `WE_CHROME`, else the first candidate that exists; throws when there is none. */
export function chromePath(env?: Record<string, string | undefined>): string;
