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

/*
  No notice naming who else is transcribing. The bar used to carry "Ana is transcribing · you're in"
  with a Leave button beside it, which said again what the record button already says: it turns red
  while this agent's microphone feeds the transcript, and pressing it is the way out. Two controls for
  one toggle, and a line of text in a bar with no room for it.
*/
export const callControl: SchemaNode = {
  type: '$if',
  props: {
    // The bar is only drawn during a call, so this needs no call condition of its own — but it does
    // need the audio one: mid-call, before devices are acquired, there is briefly nothing to record.
    condition: { $: 'modules.transcribe.available' },
    then: {
      /*
        A `we-tooltip`, not the `title` attribute this used to carry.

        Same words, and they arrived either way — but the browser's own tooltip appears after its
        own delay, in its own typeface, at the pointer rather than under the control, and follows
        no theme. Beside four call buttons that answer immediately in the app's own box, the one
        contributed button was the one that felt like a different program. `placement: 'bottom'`
        for the same reason they use it: this bar lives at the top of the window.
      */
      type: 'we-tooltip',
      props: {
        content: { $: "modules.transcribe.enabled ? 'Stop transcribing' : 'Transcribe this call'" },
        placement: 'bottom',
      },
      children: [
        {
          type: 'we-button',
          props: {
            // No `size`, matching the bar's own controls — which take `we-button`'s `md` default
            // for the same reason. A contributed button is only "one set of controls" while it is
            // the same size as the set, so this follows the bar rather than holding a size of its
            // own. `square` for the same reason: the bar's icon-only buttons are squares, and a
            // label's worth of side padding around a lone glyph is what would give this one away.
            square: true,
            /*
              Three states, not two, and the third is why this is no longer `secondary`.

              Off is `ghost`, matching how the call's own mute and camera buttons read theirs, so
              the row behaves as one set of controls rather than one module's chrome beside
              another's. Armed but not yet producing — the seconds while a model loads — is
              `secondary`, which is what this button used to be for both of the other states.

              Actually recording is `danger`, and that is the change recording-by-default
              requires. A state somebody chose can afford to be quiet; a state that arrives on
              its own has to be legible without being looked for, and a `secondary` square in a
              row of `ghost` squares is exactly the difference a person misses. It is also the
              off switch, so the loudest thing in the bar is the way out of the thing nobody
              switched on. Red is the same colour the icon inside it already used for this.
            */
            variant: {
              $: "modules.transcribe.listening ? 'danger' : modules.transcribe.enabled ? 'secondary' : 'ghost'",
            },
            onClick: { $action: 'modules.transcribe.toggle' },
          },
          children: [
            {
              /*
                What it makes, rather than the act of capturing it.

                A record dot is the universal "this is capturing" glyph and says nothing about
                what comes out; beside a microphone button that already means "capture", it read
                as a second, redder mute. Text is the thing this module produces.

                The colour moved to the button. Red used to be carried here, on the glyph, which
                was the whole live signal while the button behind it stayed `secondary` — and it
                is now the button's own fill, so the icon simply inherits its foreground and the
                two cannot state different things. Left as a colour on the icon it would have
                been red on red.

                Not `weight: 'fill'`, which this also used to carry: that quietly reaches for
                `record-fill`, and only the `regular` weight of any icon is bundled, so every
                other weight is a CDN fetch. That one fired at the moment recording started, and
                on a machine that is offline (which this app is designed to be) the icon vanished
                as you pressed it.
              */
              type: 'we-icon',
              props: { name: 'text-aa' },
            },
          ],
        },
      ],
    },
  },
};
