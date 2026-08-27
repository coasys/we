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

/**
 * The prompt's corners, following the theme's control radius — as the bar around it does.
 *
 * A flat `pill` here stayed fully rounded in a theme set to Sharp, which is the mismatch the bar
 * itself had. Restated rather than imported, for the same reason the anchor above is: a shared
 * constant would be a hard dependency on the module this is meant to work without. Both ends read
 * the same theme variable, which is what actually keeps them in step.
 *
 * The fallback is `we-button`'s own default, so on the Default preset this chip, the bar around it and
 * the buttons in both are all 8px — one radius, whatever the theme says, rather than three guesses at
 * how much a nested box should soften.
 */
const PROMPT_RADIUS = 'var(--we-theme-control-radius, var(--we-radius-400))';

/**
 * What the notice says once somebody else is transcribing.
 *
 * It used to be an offer, and the offer is what changed. Joining a peer's transcript now happens on
 * its own — see the auto-join effect in `store.ts` for why that is a narrower decision than it
 * sounds — so this stopped being a question and became the declaration that goes with it. Nobody
 * should have to work out for themselves that their microphone started feeding a shared record.
 *
 * Which makes the wording load-bearing rather than cosmetic. "Ana is transcribing · you're in" says
 * three things in the order somebody needs them: that this call is being recorded, who started it,
 * and that they are part of it. The `Leave` beside it is the whole of the consent story now — the
 * same `toggle` the record button calls, which also marks this agent as having decided, so the
 * effect does not simply switch them back on.
 *
 * Named, because "somebody is transcribing" is a notification and "Ana is transcribing" is something
 * you can act on. The DID comes from the store and the name from `$agent`, which is how this module
 * puts a name to an agent without holding any profiles of its own.
 *
 * Both branches are gated on `invitedBy` as well as their own flag. It empties when no peer is
 * recording any longer, which is reachable in both: this agent can still be recording after the
 * person who started it stopped. Without the guard the row renders " is transcribing".
 */
const peerNotice: SchemaNode = {
  type: '$if',
  props: {
    condition: {
      $and: [
        { $store: 'modules.transcribe.invitedBy' },
        {
          $or: [
            // Joined by the effect, and being told so.
            { $and: [{ $store: 'modules.transcribe.autoJoined' }, { $store: 'modules.transcribe.enabled' }] },
            // Not joined, and it could still be fixed — a node with no model, chiefly. See `invited`.
            { $store: 'modules.transcribe.invited' },
          ],
        },
      ],
    },
    then: {
      type: '$agent',
      props: { did: { $store: 'modules.transcribe.invitedBy' }, as: 'starter' },
      children: [
        {
          type: 'Row',
          props: { ay: 'center', gap: '200', px: '200', py: '100', bg: 'surface-sunken', r: PROMPT_RADIUS },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '200', truncate: true, maxWidth: '200px' },
              children: [
                {
                  $concat: [
                    '$starter.firstName',
                    ' is transcribing',
                    {
                      $if: {
                        condition: { $store: 'modules.transcribe.autoJoined' },
                        then: " · you're in",
                        else: '',
                      },
                    },
                  ],
                },
              ],
            },
            {
              /*
                One button, and which one it is follows the state rather than the other way round.

                Joined, the only thing left to offer is the way out. Not joined — which now means
                joining could not happen — it is still an offer, and pressing it is what surfaces the
                reason in the panel, since auto-join deliberately fails in silence.
              */
              type: 'we-button',
              props: { size: 'sm', variant: 'secondary', onClick: { $action: 'modules.transcribe.toggle' } },
              children: [
                { $if: { condition: { $store: 'modules.transcribe.autoJoined' }, then: 'Leave', else: 'Join' } },
              ],
            },
          ],
        },
      ],
    },
  },
};

export const callControl: SchemaNode = {
  type: '$if',
  props: {
    // The bar is only drawn during a call, so this needs no call condition of its own — but it does
    // need the audio one: mid-call, before devices are acquired, there is briefly nothing to record.
    condition: { $store: 'modules.transcribe.available' },
    then: {
      type: 'Row',
      props: { ay: 'center', gap: '200' },
      children: [
        peerNotice,
        {
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
            title: {
              $if: {
                condition: { $store: 'modules.transcribe.enabled' },
                then: 'Stop transcribing',
                else: 'Transcribe this call',
              },
            },
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
                  $if: {
                    condition: { $store: 'modules.transcribe.listening' },
                    then: 'danger',
                    else: {
                      $if: {
                        condition: { $store: 'modules.transcribe.enabled' },
                        then: 'secondary',
                        else: 'ghost',
                      },
                    },
                  },
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
      ],
    },
  },
};
