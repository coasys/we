# Transcription

The transcribe module (`@we/module-transcribe`) turns what each participant says in a call into `TextBlock`s in the [call record](../calls/README.md). Each agent transcribes only its own microphone, so the author of a block is the speaker. Being in a call starts it.

**Why:** Because each agent records only itself, the transcript needs no speaker detection: the speaker field is the block's `author` (`docs/architecture/transcripts.md`). Recording starts by itself, because when one person had to press a button, a meeting was recorded only sometimes, and the transcript then cannot show "we chose not to" apart from "nobody pressed it" (`index.ts` header).

**Parent:** [Bundled modules](../README.md)

## Parts
- [Capture](capture.md): the microphone stream, voice-activity detection on the audio thread, the transcription stream and its recovery.
- [Interpretation](interpretation.md): the passes that turn a call's transcript into proposed records, and the `interpretation` kernel.

<details><summary>How it works</summary>

**The call is the input, and it is not imported.** The module reads `media.input()`, the stream that the call publishes on the `media` kernel, and the call's `call` presence activity. Because the stream is the call's own `MediaStream`, muting the call also stops the transcript. Its toggle goes into the `call-controls` anchor, which it names as a literal (`CALL_CONTROLS_ANCHOR`).

**Where the words go.** `ensureCollection` adopts the record id from the call's presence activity. It does not create a record. Its answer is `ready`, `waiting` (the record id has not arrived yet, so the words go back into the buffer) or `nowhere` (no call). Each written block is `{ text, source: SPOKEN, generatedBy? }`, a child of the record. Then the agent links itself into the record's `participants`, so the record shows who was present, also a person who did not speak.

**When it records.** An effect starts recording when all of these are true:
- The agent is in a call, and has not stopped recording by hand in this call.
- There is a dataset and an audio input.
- The backend can transcribe (`transcription.available()`).
- The `recordCalls` setting is not false.

Stopping is per microphone. It removes this agent's words from the record, and does not stop the record.

**Contributions:**
- Panels `transcript` (order 90) and `interpretation` (order 91, `busyWhen: 'passRunning'`).
- Parts such as `transcriptFeed`, `transcriptLines`, `transcriptComposer`, `captureMeter`, `captureStatus` and `coverage`.
- Modals in `overlay`, and the function `threadLines` from `@we/messages`.
- `holds: 'enabled'`, so the chrome stays on screen while the agent records, in a space that has not enabled the module.
- The activity `transcribe` `{ id, recording, anchor, collection }`.
- Settings: `recordCalls` (`restrict`, all four levels, default true) and `timelineOrder` (agent).

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/transcribe/src/index.ts](../../../../packages/module-system/transcribe/src/index.ts): `transcribeModule`, its parts, panels, settings and activity.
- [packages/module-system/transcribe/src/store.ts](../../../../packages/module-system/transcribe/src/store.ts): `createTranscribeStore`, `ensureCollection`, `TRANSCRIBE_ACTIVITY`, the auto-join effect.
- [packages/module-system/transcribe/src/Panel.schema.ts](../../../../packages/module-system/transcribe/src/Panel.schema.ts), [CallControl.schema.ts](../../../../packages/module-system/transcribe/src/CallControl.schema.ts): the panel and the toggle.
- [docs/architecture/transcripts.md](../../../../docs/architecture/transcripts.md): the shape of a transcript as data.

</details>
