/**
 * A call in a space, and what is said in it.
 *
 * Starting, joining and leaving go through the screen. What is said goes in by tier:
 *
 * - **real** — the fake microphone plays the suite's recording, and the executor's transcription
 *   model writes it: a real speech server, or the stub server's fixed transcript (`models.mjs`).
 *   The microphone plays it in a loop, so once every line has landed the suite stops transcribing.
 * - **stub** — typed lines, written from Node as the call's author. The Coasys app places no box to
 *   type into a call (its only composer, the Feed's, writes to the space outside any call), so the
 *   suite makes the write the transcribe module's own composer makes — `modules.transcribe.addMessage`
 *   — a `TextBlock` with `source: 'typed'` (`@we/messages`, source.ts) under the call's
 *   `CollectionBlock`. The executor's call watch reads it the same way it reads a transcribed line.
 */
import { LinkQuery, Literal } from '@coasys/ad4m';
import { getEntityForDataset } from '@we/backend-ad4m';
import { until } from '@we/e2e/waits';

import { inTheCall } from '../steps/space.mjs';

/** The call this page is in, by the `call` query the app writes into the URL. */
export function callIdOf(page) {
  return new URL(page.url()).searchParams.get('call');
}

/** Starts a call from the space's own "Start a call" and resolves with the call's id. */
export async function startCall(page) {
  await page.getByRole('button', { name: 'Start a call' }).first().click();
  await until(
    () => inTheCall(page),
    (n) => n === 1,
    { timeout: 60_000, what: 'the call bar to show one in the call' },
  );
  return until(() => callIdOf(page), Boolean, { timeout: 30_000, what: 'the call id in the URL' });
}

/** Leaves the call through the call bar's own button, and waits until the bar has gone. */
export async function leaveCall(page) {
  await page.getByRole('button', { name: 'Leave the call' }).first().click();
  await until(
    () => inTheCall(page),
    (n) => n === null,
    { timeout: 30_000, what: 'the call bar to go' },
  );
}

/** Writes lines into a call as `who` typed them, one after another, in order. */
export async function typeIntoCall(who, perspective, callId, lines) {
  const TextBlock = getEntityForDataset('TextBlock', perspective);
  if (!TextBlock) throw new Error('TextBlock is not registered: createAd4mBackendPorts must run first.');
  for (const text of lines) {
    await TextBlock.create(
      perspective,
      { text, source: 'typed' },
      { parent: { id: callId, relation: 'children', entity: 'CollectionBlock' } },
    );
  }
}

/**
 * The text of every line in a call: each `TextBlock` under the call's record, read from its links —
 * spoken or typed, in no particular order.
 */
export async function linesOf(perspective, callId) {
  const children = [...new Set((await perspective.get(new LinkQuery({ source: callId }))).map((l) => l.data.target))];
  const texts = await Promise.all(
    children.map(async (id) => {
      const links = await perspective.get(new LinkQuery({ source: id }));
      const isText = links.some((l) => l.data.predicate === 'we://flag' && l.data.target === 'we://text_block');
      const text = links.filter((l) => l.data.predicate === 'we://text').at(-1)?.data.target;
      return isText && text ? String(Literal.fromUrl(text).get()) : null;
    }),
  );
  return texts.filter((t) => t !== null);
}

/**
 * Waits until the call's lines hold every one of `words` (without case), and resolves with the lines.
 * The real tier's check that what the microphone played landed in the transcript: the words are ones
 * only the recording says (`HEARD` in stub-llm.mjs), so nothing else on the page or in the space can
 * pass it.
 */
export function untilHeard(perspective, callId, words, timeout) {
  return until(
    () => linesOf(perspective, callId),
    (lines) => {
      const said = lines.join('\n').toLowerCase();
      return words.every((w) => said.includes(w));
    },
    { timeout, interval: 3_000, what: `the call's lines to say ${words.join(', ')}` },
  );
}

/**
 * Stops this agent's microphone feeding the call's transcript, with the call bar's own control, and
 * waits until the control offers to start again. The call, its record and its extraction watch stay:
 * a record's lifetime is the call's, not the toggle's (transcribe store.ts, `collectionCallId`).
 *
 * The real tier needs this because Chromium's fake microphone plays its recording in a loop: left on,
 * the transcript grows by the recording every few seconds, and so does every extraction prompt.
 */
export async function stopTranscribing(page) {
  await page.getByRole('button', { name: 'Stop transcribing', exact: true }).first().click();
  await page.getByRole('button', { name: 'Transcribe this call', exact: true }).first().waitFor({ timeout: 30_000 });
}

/**
 * Registers the call's extraction watch, the one the app's `watchConversation` registers (app-shell
 * DatasetStore.tsx): the same id, the call's own targets, filed under the space's collection, with
 * `extracted` and `recognised` back to the call.
 *
 * The stub tier stands in for the transcriber here, as {@link typeIntoCall} stands in for its write.
 * The app registers a call's watch only when the transcribe module first files a transcribed line
 * (`ensureCollection`), and with no transcription model the module never joins the call — so a call
 * of typed lines alone is never watched. That gap is the product's; see the README's backlog.
 */
export async function watchCall(who, perspective, callId) {
  const targets = await until(
    async () => (await perspective.get(new LinkQuery({ source: callId, predicate: 'we://extraction_targets' })))[0],
    Boolean,
    { timeout: 60_000, what: 'the call to record what it looks for' },
  );
  const stored = Literal.fromUrl(targets.data.target).get();
  const classes = Array.isArray(stored) ? stored : JSON.parse(String(stored));
  const Space = getEntityForDataset('Space', perspective);
  const space = (await Space.findAll(perspective, { include: { root: true } }))[0];
  const root = typeof space?.root === 'string' ? space.root : space?.root?.id;
  await who.ports.interpretation.watch(perspective, {
    watchId: `we-call-${callId.replace(/[^a-zA-Z0-9]+/g, '-')}`,
    classes,
    parent: { id: root || callId, relation: 'children', entity: 'CollectionBlock' },
    provenance: { id: callId, relation: 'extracted', entity: 'CollectionBlock' },
    recognised: { id: callId, relation: 'recognised', entity: 'CollectionBlock' },
  });
  return classes;
}
