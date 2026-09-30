import type { SchemaNode } from '@we/schema-shared';
import { confirmModal } from '@we/template-kit';

/**
 * DestructivePrompt — the host's own "are you sure?" in front of anything a space template deletes.
 *
 * ## Why the host asks rather than the template
 *
 * `templateSurface.ts` has marked members `destructive` since it was written, and says the flag
 * exists so a host can demand a confirmation "in host chrome, where a theme's CSS cannot restyle
 * it". Nothing demanded one: the option was there, all three `buildTemplateBag` call sites passed
 * nothing, and every delete a space template could name ran on one unqualified click.
 *
 * Leaving it to the templates does not work, and not because template authors are careless. Half of
 * WE's own delete buttons wrote a `confirmModal` and half did not — the usual fate of a rule that
 * lives at the call sites — but the real problem is that a *space* template comes from a stranger.
 * Whether it asks before deleting is the stranger's decision, and a hostile one simply declines to.
 * A dialog raised by the tier boundary cannot be omitted, restyled, reworded or clicked through by
 * the thing that triggered it.
 *
 * So the templates no longer write their own for these actions, and this is the only one.
 *
 * ## Why the wording comes from the store
 *
 * The same argument: the template is what is being guarded against, so the sentence describing what
 * it is about to do must not be its. `describeDestructive` in `ShellStore` writes it from the action
 * and its arguments. Uniform on purpose — a person learns what WE's delete confirmation looks like,
 * and nothing inside a space can imitate it.
 */
export const destructivePrompt: SchemaNode = confirmModal({
  open: { $: 'shellStore.pendingDestructive' },
  // Dismissing is declining. The backdrop, Escape, the close button and Cancel all land here, and
  // all of them resolve the waiting action with "no" rather than leaving it hanging.
  close: { $action: 'shellStore.cancelDestructive' },
  title: { $: 'shellStore.pendingDestructive.title' },
  body: { $: 'shellStore.pendingDestructive.body' },
  // The action being confirmed, verbatim. Small print rather than the body, because the body is
  // what the reader needs and this is what an author or a suspicious reader needs.
  detail: { $: 'shellStore.pendingDestructive.path' },
  confirmLabel: 'Delete',
  confirm: { $action: 'shellStore.confirmDestructive' },
  cancelLabel: 'Cancel',
});
