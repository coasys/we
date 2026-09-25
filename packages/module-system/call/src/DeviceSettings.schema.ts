/**
 * Which microphone and camera this agent is sending — the chooser, and the sheet it lives in.
 *
 * ## One fragment, two doors
 *
 * The same node is placed twice: from the call bar's More menu, where somebody who cannot be heard
 * reaches for it mid-call, and from app settings, where somebody chooses before joining anything.
 * Those are the two moments it is wanted and they are genuinely different — in a call the devices
 * are already open, out of one they are not — so the fragment says which it is rather than
 * pretending the states are the same.
 *
 * ## Why the names can be missing
 *
 * A browser withholds device labels until capture has been allowed at least once, so that a page
 * cannot fingerprint a machine by its hardware without asking. A chooser opened before any call has
 * ever run therefore lists numbered devices. That is not a fault to hide: the sheet says so and
 * offers the one thing that fixes it, which is to ask for a device once and let go.
 */
import { expr, type SchemaNode } from '@we/schema-shared';

/** A labelled picker over one kind of device. */
function devicePicker(options: {
  label: string;
  icon: string;
  options: string;
  value: string;
  kind: 'audio' | 'video';
  empty: string;
}): SchemaNode {
  return {
    type: '$if',
    props: {
      /*
        A picker only where there is something to pick between.

        A list holding nothing but "System default" is a control that cannot be operated, so the
        sentence below takes its place — and which sentence depends on whether we have been *allowed*
        to look, which is the distinction `devicesProbed` carries.
      */
      condition: { $: `count(${options.options}) > 1` },
      then: {
        type: 'we-form-field',
        props: { label: options.label },
        children: [
          {
            type: 'we-select',
            props: {
              width: '100%',
              options: { $: options.options },
              value: { $: options.value },
              /*
                The id goes straight through. `setDevice` writes it to this machine's storage and,
                in a call, swaps the track without renegotiating — so the change is immediate and
                outlives the call, which is the whole point of choosing rather than being assigned.
              */
              onChange: { $action: 'modules.call.setDevice', args: [options.kind, { $: 'event.detail' }] },
            },
          },
        ],
      },
      /*
        Said only once this machine has actually been asked.

        Before a capture has ever been allowed, a browser lists no devices at all — so "no microphone
        found on this computer" is a claim about hardware, made from a list that was never permitted
        to mention any. That was the first thing the settings page said on a machine with a working
        microphone plugged into it. Until we have asked, the honest state is the block below the
        pickers, which offers to ask.
      */
      else: {
        type: '$if',
        props: {
          condition: { $: 'modules.call.devicesProbed' },
          then: {
            type: 'Row',
            props: { gap: '200', ay: 'center' },
            children: [
              { type: 'we-icon', props: { name: options.icon, color: 'text-faint' } },
              { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: [options.empty] },
            ],
          },
        },
      },
    },
  };
}

/**
 * The chooser itself, without a sheet around it — so a settings page can place it inline.
 *
 * A part rather than a panel: it is a small piece of a screen somebody else composes, and it has no
 * state of its own beyond what the store already holds.
 */
export const deviceSettings: SchemaNode = {
  type: 'Column',
  props: { gap: '400', width: '100%' },
  children: [
    devicePicker({
      label: 'Microphone',
      icon: 'microphone-slash',
      options: 'modules.call.microphoneOptions',
      value: 'modules.call.audioDevice',
      kind: 'audio',
      empty: 'No microphone found on this computer.',
    }),
    devicePicker({
      label: 'Camera',
      icon: 'video-camera-slash',
      options: 'modules.call.cameraOptions',
      value: 'modules.call.videoDevice',
      kind: 'video',
      empty: 'No camera found on this computer.',
    }),
    /*
      The way out of a list this machine has not been allowed to describe.

      Two states reach it and they look different on screen but have the same remedy. Either devices
      are listed and anonymous — a browser withholds labels until a capture has been allowed, so that
      a page cannot fingerprint a machine by its hardware — or nothing is listed at all, which is what
      the same refusal looks like in a stricter browser. Both are "we have not been permitted to
      look", and both are fixed by asking once.

      Gone once the machine has been asked: in a call the devices are open and the names have
      arrived, and after a probe that found nothing the sentence above is the true one. So this is a
      button that offers to fix something, only while there is something to fix.
    */
    {
      type: '$if',
      props: {
        condition: expr`!modules.call.devicesProbed && !modules.call.devicesNamed`,
        then: {
          type: 'Column',
          props: { gap: '200', p: '300', r: 'surface', bg: 'surface-sunken' },
          children: [
            {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted' },
              children: [
                'This computer will not list your microphones and cameras, or say what they are ' +
                  'called, until it has been asked for one at least once.',
              ],
            },
            {
              type: 'we-button',
              props: {
                variant: 'secondary',
                size: 'sm',
                alignSelf: 'start',
                onClick: { $action: 'modules.call.nameDevices' },
              },
              children: ['Allow access to list devices'],
            },
          ],
        },
      },
    },
  ],
};

/**
 * The chooser as a sheet, gated on the module's own flag.
 *
 * Chrome rather than a panel, and mounted for the life of the shell: it is opened from the call
 * bar, which is itself chrome, and from a settings page, which is an overlay — neither of which can
 * own a dialog the other also opens. The same argument the host makes for its create-space modal,
 * one layer down.
 */
export const deviceSettingsModal: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.call.deviceSettingsOpen' },
    then: {
      type: 'we-modal',
      props: { size: 'sm', close: { $action: 'modules.call.closeDeviceSettings' } },
      children: [
        {
          type: 'we-text',
          props: { variant: 'heading-sm', tag: 'h2' },
          slot: 'header',
          children: ['Camera and microphone'],
        },
        deviceSettings,
        {
          type: 'Row',
          props: { ax: 'end', width: '100%' },
          slot: 'footer',
          children: [
            {
              type: 'we-button',
              props: { variant: 'primary', onClick: { $action: 'modules.call.closeDeviceSettings' } },
              children: ['Done'],
            },
          ],
        },
      ],
    },
  },
};
