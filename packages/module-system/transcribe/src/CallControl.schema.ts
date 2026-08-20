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
 * The offer to join a transcript somebody else started.
 *
 * A prompt rather than starting on this agent's behalf: what is being turned on is their microphone,
 * feeding durable text into a space other people read, and that is not a decision a peer gets to
 * take for them. So the coverage cost is real and accepted — a call where nobody accepts is a call
 * transcribed from one microphone.
 *
 * Named, because "somebody is transcribing" is a notification and "Ana started transcribing" is
 * something you can act on. The DID comes from the store and the name from `$agent`, which is how
 * this module puts a name to an agent without holding any profiles of its own.
 *
 * Dismissable, and dismissed per peer — see `dismissInvite`. Nothing here starts recording; the only
 * thing the accept button does is the same `toggle` the record button beside it calls.
 */
const joinPrompt: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'modules.transcribe.invited' },
    then: {
      type: '$agent',
      props: { did: { $store: 'modules.transcribe.invitedBy' }, as: 'starter' },
      children: [
        {
          type: 'Row',
          props: { ay: 'center', gap: '200', px: '200', py: '100', bg: 'neutral-100', r: PROMPT_RADIUS },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '200', truncate: true, maxWidth: '180px' },
              children: [{ $concat: ['$starter.firstName', ' is transcribing'] }],
            },
            {
              type: 'we-button',
              props: { size: 'sm', variant: 'secondary', onClick: { $action: 'modules.transcribe.toggle' } },
              children: ['Join'],
            },
            {
              type: 'we-button',
              props: {
                size: 'sm',
                variant: 'ghost',
                square: true,
                title: 'Not now',
                onClick: { $action: 'modules.transcribe.dismissInvite' },
              },
              children: [{ type: 'we-icon', props: { name: 'x' } }],
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
        joinPrompt,
        {
          type: 'we-button',
          props: {
            // No `size`, matching the bar's own controls — which take `we-button`'s `md` default for
            // the same reason. A contributed button is only "one set of controls" while it is the
            // same size as the set, so this follows the bar rather than holding a size of its own.
            // `square` for the same reason: the bar's icon-only buttons are squares, and a label's
            // worth of side padding around a lone glyph is what would give this one away.
            square: true,
            //
            // Matches how the call's own mute and camera buttons read their state, so the row behaves
            // as one set of controls rather than one module's chrome sitting next to another's.
            variant: {
              $if: { condition: { $store: 'modules.transcribe.enabled' }, then: 'secondary', else: 'ghost' },
            },
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
              /*
                What it makes, rather than the act of capturing it.

                A record dot is the universal "this is capturing" glyph and says nothing about what
                comes out; beside a microphone button that already means "capture", it read as a
                second, redder mute. Text is the thing this module produces.

                Red while listening carries the live state on its own now. It used to be carried by
                `weight: 'fill'` as well, which quietly reached for `record-fill` — and only the
                `regular` weight of any icon is bundled, so every other weight is a CDN fetch. That
                one fired at the moment recording started, and on a machine that is offline (which
                this app is designed to be) the icon simply vanished as you pressed it.
              */
              type: 'we-icon',
              props: {
                name: 'text-aa',
                color: {
                  $if: { condition: { $store: 'modules.transcribe.listening' }, then: 'danger-500', else: '' },
                },
              },
            },
          ],
        },
      ],
    },
  },
};
