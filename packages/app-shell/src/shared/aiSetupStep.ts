/**
 * The AI step of a first run: after a new account's identity is made, before the app appears, the
 * person chooses where its models run — this device, a model server, or nothing for now.
 *
 * Asked once per node, on the first account made against it, and only where there is something to
 * choose. A node that already has a model (the launcher's own onboarding set one up, or the operator
 * did) has its answer. A connection that may not change the node's AI — a managed user on a node somebody else runs — has no question
 * it could answer, so it is not asked one: the step offers only what this connection can do, and
 * Skip, and is absent when Skip would be the only thing on it.
 */

/** The ways to get AI the step can offer, in the order it offers them. */
export type AiSetupOption = 'local' | 'server' | 'skip';

/** What this connection may do with the node's AI — the runtime store's capability flags. */
export interface AiSetupAbilities {
  /** Local AI can be installed and run on the node's machine from here. */
  canConfigureLocalAi: boolean;
  /** Models can be added and changed, not only listed. */
  canConfigureAi: boolean;
  /** The node shows its model servers to this connection. */
  canManageAiEndpoints: boolean;
}

/**
 * What can be chosen. "This device" needs local AI it may install; "a model server" needs both the
 * servers and the right to add models to them. Skip is always there.
 */
export function aiSetupOptions(abilities: AiSetupAbilities): AiSetupOption[] {
  return [
    ...(abilities.canConfigureLocalAi ? (['local'] as const) : []),
    ...(abilities.canConfigureAi && abilities.canManageAiEndpoints ? (['server'] as const) : []),
    'skip',
  ];
}

export interface AiStepFacts extends AiSetupAbilities {
  /** How many models the node has. */
  models: number;
  /** Local AI finished an install on the node's machine. */
  localInstalled: boolean;
  /** An account on this node answered the step already. */
  answered: boolean;
}

/** Whether to ask: something besides Skip to offer, nothing set up yet, and no answer yet. */
export function offersAiStep(facts: AiStepFacts): boolean {
  if (facts.answered || facts.models > 0 || facts.localInstalled) return false;
  return aiSetupOptions(facts).length > 1;
}

/** How the step was left: with something set up, or skipped. */
export type AiSetupAnswer = 'set-up' | 'skipped';

/**
 * Where a node's answer is kept, by the node's address. On the device, as the account is. Per node,
 * not per agent: the step runs only for an agent just made, which never has an answer of its own.
 */
const answerKey = (node: string) => `we.aiSetup.answer:${node}`;

type AnswerStore = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): AnswerStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The node's answer to the step, or null when no account on it has given one. */
export function readAiSetupAnswer(node: string, store: AnswerStore | null = storage()): AiSetupAnswer | null {
  if (!node || !store) return null;
  const value = store.getItem(answerKey(node));
  return value === 'set-up' || value === 'skipped' ? value : null;
}

/** Keeps the node's answer, so the step does not come back for another account on it. */
export function recordAiSetupAnswer(node: string, answer: AiSetupAnswer, store: AnswerStore | null = storage()): void {
  if (!node || !store) return;
  try {
    store.setItem(answerKey(node), answer);
  } catch {
    // A full or refused store forgets the answer; the step is still asked only on a first run.
  }
}
