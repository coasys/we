/**
 * "Decide these together?" — the one confirmation every Accept and Discard can raise.
 *
 * Mounted once, as chrome on the host's `overlay` anchor, because the buttons that raise it are
 * everywhere: a card on the workshop canvas, the inspector, a task board, the extraction panel. All
 * of them call `acceptProposal` / `rejectProposal`, which hold the decision in `tiedDecision` when it
 * would decide other suggestions too, so the question is asked in one place and in one voice
 * whichever surface the press came from. See `TiedDecision` in the store for why it exists.
 *
 * Two dialogs rather than one with a computed tone: accepting decides nothing destructive and asks
 * in the primary tone, while discarding removes records — some of them already accepted — and asks
 * in the danger tone, with its own icon and button.
 */
import { confirmModal } from '@we/schema-kit';
import type { SchemaNode } from '@we/schema-shared';

const DECISION = 'modules.transcribe.tiedDecision';

const dialog = (kind: 'accept' | 'reject'): SchemaNode =>
  confirmModal({
    open: { $: `${DECISION} && ${DECISION}.kind == '${kind}'` },
    close: { $action: 'modules.transcribe.cancelTiedDecision' },
    title: { $: `${DECISION}.title` },
    body: { $: `${DECISION}.body` },
    // Only when there is one: `detail` always draws its line, and an empty one is a gap.
    children: [
      {
        type: '$if',
        props: {
          condition: { $: `${DECISION}.detail` },
          then: { type: 'we-text', props: { color: 'text-muted' }, children: [{ $: `${DECISION}.detail` }] },
        },
      },
    ],
    confirmLabel: { $: `${DECISION}.confirmLabel` },
    confirm: { $action: 'modules.transcribe.confirmTiedDecision' },
    tone: kind === 'accept' ? 'primary' : 'danger',
    busy: { $: 'modules.transcribe.tiedBusy' },
  });

/** Both, for the module to mount — one slot each, so neither needs a wrapper to sit in. */
export const tiedDecisionModals: SchemaNode[] = [dialog('accept'), dialog('reject')];
