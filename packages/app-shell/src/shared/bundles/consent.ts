/**
 * What agreeing to an install grants, and what a later version asks for beyond it.
 *
 * An update must not inherit consent it was never given. Accepting version 1 agreed to what version
 * 1 was shown to do; if version 2 also reaches for the space's members, or turns on calls, or brings
 * a new kind of record, that is new, and the prompt should say so first rather than list it among
 * everything already agreed, where it reads as one more line of the same.
 *
 * Kept as what the person was shown, in the form the judgement derives it — capability groups, not
 * their wording, so rewording a group never makes it look new; module ids; record type names — and
 * compared against the judgement of the newer version. Both sides are derived from the templates,
 * never read from what a file says about itself, so the difference cannot be declared away.
 */
import { describeCapabilities } from '../templateAcceptance';
import type { BundleJudgement } from './judgeBundle';

/** What an install was agreed to: kept on its install record. */
export interface BundleGrant {
  groups: string[];
  modules: string[];
  recordTypes: string[];
}

/** What a newer version asks for that the installed one was not agreed to, in the words a person reads. */
export interface WhatIsNew {
  capabilities: string[];
  /** Module ids — the caller names them. */
  modules: string[];
  recordTypes: string[];
}

export function grantOf(judged: Pick<BundleJudgement, 'groups' | 'modules' | 'adds'>): BundleGrant {
  return { groups: [...judged.groups], modules: [...judged.modules], recordTypes: [...judged.adds.recordTypes] };
}

/**
 * What `judged` asks for beyond `granted`, or `null` when nothing was recorded — an install from
 * before grants were kept, where the honest answer is "unknown", so the whole list is shown as it
 * always was rather than an empty difference passing for "nothing new".
 */
export function whatIsNew(
  judged: Pick<BundleJudgement, 'groups' | 'modules' | 'adds'>,
  granted: BundleGrant | undefined,
): WhatIsNew | null {
  if (!granted) return null;
  const had = (list: readonly string[]) => new Set(list);
  const groups = had(granted.groups);
  const modules = had(granted.modules);
  const recordTypes = had(granted.recordTypes);
  return {
    capabilities: describeCapabilities(judged.groups.filter((group) => !groups.has(group))),
    modules: judged.modules.filter((id) => !modules.has(id)),
    recordTypes: judged.adds.recordTypes.filter((name) => !recordTypes.has(name)),
  };
}

/** Whether a difference asks for anything at all. */
export function asksForMore(news: WhatIsNew): boolean {
  return news.capabilities.length > 0 || news.modules.length > 0 || news.recordTypes.length > 0;
}
