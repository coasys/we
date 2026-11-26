/**
 * V4's call must be a question a model cannot file as a decision, a risk or a task.
 *
 * The real tier (qwen, nightly 2026-11-26 coasys-spaces #93214) read the film — a decision, a risk
 * and "Alice will rebuild the sync script by Friday" beside the question — and wrote no TeamQuestion.
 * These checks fail on that film and pass when the call says one open question.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { answer, roleOf, startStubLlm, TRANSCRIPT, V4_LINE, V4_SCRIPT, v4CallScript } from './stub-llm.mjs';

/** Cue words that invite a Decision, a Task, a Tension or a dated action. */
const CUES = [
  /\bdecide\b/i,
  /\bdecided\b/i,
  /\bdecision\b/i,
  /\bwe will\b/i,
  /\bwe'll\b/i,
  /\bi will\b/i,
  /\bi'll\b/i,
  /\bwill do\b/i,
  /\bby friday\b/i,
  /\bfriday\b/i,
  /\bdeadline\b/i,
  /\bassign(?:ed|ee|ment)?\b/i,
  /\brisks?\b/i,
  /\bblockers?\b/i,
  /\baction items?\b/i,
  /\bagreed\b/i,
  /\blet'?s go with\b/i,
  /\bowner\b/i,
  /\bdue\b/i,
  /\balice\b/i,
  /\bbob\b/i,
];

/** The classes the package offers a call, with the fields the script fills. */
const CLASSES = [
  { name: 'TeamQuestion', fields: [{ name: 'asks', required: true }, { name: 'options' }, { name: 'status' }] },
  { name: 'Task', fields: [{ name: 'title', required: true }, { name: 'owner' }] },
  { name: 'Decision', fields: [{ name: 'what', required: true }, { name: 'agreedBy' }, { name: 'when' }] },
  { name: 'Tension', fields: [{ name: 'between', required: true }, { name: 'why' }] },
];

/** Sentences in `text`, split on line breaks and on . ! ? */
function sentences(text) {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('the V4 call script', () => {
  it('is one open question and names no decision, task, risk, owner or date', () => {
    const text = v4CallScript();
    for (const cue of CUES) expect(text, String(cue)).not.toMatch(cue);
    const asked = sentences(text);
    expect(asked).toHaveLength(1);
    expect(asked[0].endsWith('?')).toBe(true);
    expect(text.match(/\?/g)).toHaveLength(1);
    expect(text.includes('!')).toBe(false);
  });

  it('the stub extracts a TeamQuestion from that text and no other role', () => {
    const records = answer({
      classes: CLASSES,
      transcript: v4CallScript()
        .split('\n')
        .map((text) => ({ text })),
    });
    expect(records.map((r) => roleOf(r.class))).toEqual(['question']);
    expect(records[0]).toMatchObject({ class: 'TeamQuestion', asks: V4_LINE });
    // The title `expectedRecords(V4_SCRIPT)` waits for is this same question.
    expect(V4_SCRIPT).toEqual([
      expect.objectContaining({ role: 'question', fields: expect.objectContaining({ asks: V4_LINE }) }),
    ]);
  });

  it('the film still yields a question, a task, a decision and a tension', () => {
    const records = answer({
      classes: CLASSES,
      transcript: TRANSCRIPT.map((text) => ({ text })),
    });
    expect(records.map((r) => roleOf(r.class)).sort()).toEqual(['decision', 'question', 'task', 'tension']);
  });
});

describe('the pinned V4 transcript', () => {
  let stub;
  afterEach(() => stub?.close());

  function utterance() {
    const boundary = 'v4-script-boundary';
    const body = [
      `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${stub.transcriptionModel}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="utterance.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFF\r\n`,
      `--${boundary}--\r\n`,
    ].join('');
    return fetch(`${stub.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      body,
    }).then(async (response) => {
      expect(response.status).toBe(200);
      return (await response.json()).text;
    });
  }

  it('replaces the film for the next utterances and then resumes where the film was', async () => {
    stub = await startStubLlm();
    expect(await utterance()).toBe(TRANSCRIPT[0]);
    stub.pinTranscript([V4_LINE]);
    expect(await utterance()).toBe(V4_LINE);
    expect(await utterance()).toBe(V4_LINE);
    stub.pinTranscript(null);
    expect(await utterance()).toBe(TRANSCRIPT[1]);
  });
});
