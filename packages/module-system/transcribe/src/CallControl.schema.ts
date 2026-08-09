/**
 * The record toggle, contributed into the call's control bar.
 *
 * It sits beside mute and camera because that is what it is — a thing you turn on for this call,
 * while your attention is already on that bar. The module rail is where you *open the transcript*;
 * conflating the two put the only way to start recording on the far edge of the screen behind an
 * icon that gave no hint it had anything to do with the call in front of you.
 *
 * ## How it gets there
 *
 * Contributed to the `call-controls` anchor, which `@we/module-call` declares and marks with a
 * `$slot` in its bar. Neither module imports or names the other: the call module knows it has a bar
 * worth extending, this one knows it belongs in a call, and the host joins them. Uninstall the call
 * module and this contributes to an anchor nobody provides — reported at boot, rendering nothing.
 * The reverse works too: the bar simply has one fewer button.
 *
 * The anchor string is duplicated rather than imported for exactly that reason. Importing
 * `CALL_CONTROLS_ANCHOR` from `@we/module-call` would be a hard dependency on the module this is
 * meant to be independent of — the same coupling, moved from the schema into the import graph.
 */
import { type SchemaNode } from '@we/schema-shared';

/** Must match `CALL_CONTROLS_ANCHOR` in `@we/module-call`. Deliberately not imported — see above. */
export const CALL_CONTROLS_ANCHOR = 'call-controls';

export const callControl: SchemaNode = {
  type: '$if',
  props: {
    // The bar is only drawn during a call, so this needs no call condition of its own — but it does
    // need the audio one: mid-call, before devices are acquired, there is briefly nothing to record.
    condition: { $store: 'modules.transcribe.available' },
    then: {
      type: 'we-button',
      props: {
        size: 'sm',
        // Matches how the call's own mute and camera buttons read their state, so the row behaves as
        // one set of controls rather than as one module's chrome sitting next to another's.
        variant: { $if: { condition: { $store: 'modules.transcribe.enabled' }, then: 'secondary', else: 'ghost' } },
        onClick: { $action: 'modules.transcribe.toggle' },
        title: {
          $if: {
            condition: { $store: 'modules.transcribe.enabled' },
            then: 'Stop transcribing',
            else: 'Transcribe this call',
          },
        },
      },
      children: [
        {
          // Filled while recording — the same "this is live" language a record button anywhere uses,
          // and readable at a glance in a bar of otherwise outline icons.
          type: 'we-icon',
          props: {
            name: 'record',
            weight: { $if: { condition: { $store: 'modules.transcribe.listening' }, then: 'fill', else: 'regular' } },
            color: { $if: { condition: { $store: 'modules.transcribe.listening' }, then: 'danger-500', else: '' } },
          },
        },
      ],
    },
  },
};
