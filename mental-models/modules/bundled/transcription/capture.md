# Capture

Capture takes the call's microphone stream, finds the spans of speech on the audio thread, and sends each span to the backend's transcription stream. The text that comes back is collected into blocks of about 1000 characters.

**Why:** The backend transcribes an utterance, not a microphone, so something must decide where an utterance ends, for each 128-sample frame. The main thread can drop audio during a slow render, so an `AudioWorkletProcessor` decides this on the audio thread, and also resamples to the 16 kHz that the speech model uses (`workletSource.ts` header). Blocks of 1000 characters are a compromise: one block per utterance writes a record every few seconds for each participant, and one block per call is a wall of text (`MAX_CHARS` comment).

**Parent:** [Transcription](README.md)

<details><summary>How it works</summary>

```
media.input() ─► AudioWorkletNode (WORKLET_SOURCE, thresholds from VAD)
                   │ { kind: 'utterance', audio }   16 kHz mono PCM
                   │ { kind: 'level', rms, speaking }  for the meter
                   ▼
            transcription.open(modelId, onText) ─► text
                   ▼
            buffer ─► TextBlock in the call record  (at MAX_CHARS, or FLUSH_AFTER_MS of silence)
```

- **The worklet** is source text (`WORKLET_SOURCE`) that the store turns into a blob URL, because a worklet cannot import anything. The store sends the `VAD` thresholds to it, which override the defaults in the source. A muted track gives zeros, so no utterance starts.
- **The model.** `transcription.models()` lists the models. The store uses the default ready model. If no model is ready, the status is `model-unready` and the store asks again every `MODEL_POLL_MS` (3 s). `transcription.setup()` can offer a speech server to connect.
- **The buffer** is written as one block at `MAX_CHARS` (1000), or after `FLUSH_AFTER_MS` (3 s) of silence.
- **Recovery.** A dropped stream is opened again after each of `RECONNECT_DELAYS_MS` (0, 1, 3, 8, 15 and 30 s). While the stream is down, up to `MAX_HELD_SAMPLES` (60 s of audio) is held, and the oldest is dropped first. An utterance that `REFUSALS_BEFORE_DROPPING` (2) newly opened streams refuse is dropped, so one bad utterance costs one utterance. When the executor reports a full queue, the utterance waits `QUEUE_FULL_RETRY_MS` (2 s) and goes to the same stream, and at most `MAX_BACKLOG_SAMPLES` (30 s) waits.

</details>

<details><summary>Where in the code</summary>

- [packages/module-system/transcribe/src/workletSource.ts](../../../../packages/module-system/transcribe/src/workletSource.ts): `WORKLET_SOURCE`, `WORKLET_NAME`, the messages the worklet sends.
- [packages/module-system/transcribe/src/store.ts](../../../../packages/module-system/transcribe/src/store.ts): `VAD`, `MAX_CHARS`, `FLUSH_AFTER_MS`, `RECONNECT_DELAYS_MS`, `MAX_HELD_SAMPLES`, `REFUSALS_BEFORE_DROPPING`, `QUEUE_FULL_RETRY_MS`, `MAX_BACKLOG_SAMPLES`.
- [packages/backend-system/shared/src/transcription.ts](../../../../packages/backend-system/shared/src/transcription.ts): `TranscriptionPort` (`models`, `open`, `setup`), which the `transcription` kernel is.

</details>
