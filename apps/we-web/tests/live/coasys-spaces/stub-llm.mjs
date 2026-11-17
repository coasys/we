/**
 * An OpenAI-compatible language model that answers from a script: the stub tier's stand-in for a
 * real model, so extraction runs end to end with exact, repeatable results.
 *
 * ## What the executor sends, and what it reads back (ad4m at WE's pin)
 *
 * WE registers its call watch with the auto-processor and no tool budget, so a pass takes the
 * executor's single-shot path: one non-streaming `POST /v1/chat/completions` with no `tools`, the
 * interpretation system prompt, five few-shot user/assistant pairs, and the real input last. Every
 * user message is a JSON document:
 *
 *     {"classes":[{"name","hint","existing":[{"id","title","class"}],"fields":[{"name","required","hint"}]}],
 *      "transcript":[{"speaker","text","timestamp"?}], "active_flows"?:[…]}
 *
 * The executor reads `choices[0].message.content` as text, strips `<think>` blocks and code fences,
 * and takes the first JSON value in it: a bare array of `{"class": <name>, ...fields}` is the
 * simplest answer it accepts (`parse.rs`). So the stub reads the **last** user message — the earlier
 * ones are the few-shot examples, about classes called Task and Belief — and answers with that array.
 *
 * Anything else (a title, a summary, a prompt that is not JSON) gets a short plain answer, so a
 * caller that is not extraction still sees a well-formed completion. `stream: true` is answered as
 * server-sent events for the same reason.
 *
 * ## The script
 *
 * {@link SCRIPT} maps what the suite says in a call to the records a model should find in it, by the
 * class's role rather than its exact name: a space whose classes are the social DNA package's
 * (`Question`, `Tension`, `Decision`, `Task`) gets those, and the Coasys starter's `TaskBlock` gets
 * the task. Only classes the prompt offers are answered, only fields the prompt lists are filled, and
 * a record whose title the prompt lists as existing is not proposed again — the same discipline a
 * real model is asked for, so the executor's dedup is not what makes the result converge.
 */
import { createServer } from 'node:http';

import { freePort } from '../harness.mjs';

/** The film's lines, as the suite types them into the call and as `fixtures/call.wav` speaks them. */
export const LINES = {
  sync: 'Sync dropped my edits again. Should we rebuild it?',
  mobile: 'Okay: mobile comes first this quarter.',
  release: 'A rebuild could push back the v2.4 release.',
  task: 'Alice will rebuild the sync script by Friday.',
};

/**
 * One word from each line that only the transcript holds: not in a space's name, and not a word the
 * suite types anywhere else. The real tier reads them in the call's lines to know that every line
 * landed, whatever else the speech-to-text model wrote. Lower case; matched without case.
 */
export const HEARD = ['edits', 'quarter', 'release', 'friday'];

/**
 * What each line yields, per role. `when` is matched against the transcript (lower-cased); `role`
 * picks the class; `fields` are by the package's field names, with `title` as the fallback every
 * class with a title field takes.
 */
export const SCRIPT = [
  {
    when: 'should we rebuild',
    role: 'question',
    fields: { asks: 'Should we rebuild sync?', options: 'rebuild / patch', status: 'open' },
  },
  {
    when: 'rebuild the sync script',
    role: 'task',
    fields: { title: 'Rebuild the sync script', owner: 'Alice' },
  },
  {
    when: 'mobile comes first',
    role: 'decision',
    fields: { what: 'Mobile comes first this quarter', agreedBy: '', when: 'this quarter' },
  },
  {
    when: 'push back the v2.4 release',
    role: 'tension',
    fields: { between: 'sync rebuild vs v2.4 release', why: 'A rebuild could push back the v2.4 release.' },
  },
];

/**
 * Which role a class plays, from its name: the package's names, and WE's own task block. The one
 * mapping: the stub answers by it, and the suite's expectations (`expectedRecords` in steps.mjs) read it.
 */
export function roleOf(className) {
  const name = String(className).toLowerCase().split(/[/#:]/).pop();
  if (name === 'question') return 'question';
  if (name === 'tension') return 'tension';
  if (name === 'decision') return 'decision';
  if (name === 'task' || name === 'taskblock') return 'task';
  return null;
}

/** The value a record is known by: its identity field, or the first field the prompt requires. */
function titleOf(cls, record) {
  const required = (cls.fields ?? []).find((f) => f.required)?.name;
  return String(record[required] ?? record.title ?? '');
}

/** The records the script finds in one interpretation input. Exported for the suite's own checks. */
export function answer(input) {
  const said = (input.transcript ?? []).map((t) => String(t.text ?? '').toLowerCase()).join('\n');
  const out = [];
  for (const cls of input.classes ?? []) {
    const role = roleOf(cls.name);
    if (!role) continue;
    const fields = new Set((cls.fields ?? []).map((f) => f.name));
    const existing = new Set((cls.existing ?? []).map((e) => String(e.title ?? '').toLowerCase()));
    for (const entry of SCRIPT) {
      if (entry.role !== role || !said.includes(entry.when)) continue;
      const record = { class: cls.name };
      for (const [name, value] of Object.entries(entry.fields)) {
        if (fields.has(name) && value !== '') record[name] = value;
      }
      // A class without the package's field names (the starter's TaskBlock) still gets a title.
      if (fields.has('title') && !record.title) record.title = Object.values(entry.fields)[0];
      if (!titleOf(cls, record) || existing.has(titleOf(cls, record).toLowerCase())) continue;
      out.push(record);
    }
  }
  return out;
}

const textOf = (content) =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => (typeof part === 'string' ? part : (part?.text ?? ''))).join('')
      : '';

/** The reply to one chat request, and what kind of prompt it was. */
function reply(body) {
  const users = (body.messages ?? []).filter((m) => m.role === 'user');
  const last = textOf(users.at(-1)?.content);
  let input = null;
  try {
    input = JSON.parse(last);
  } catch {
    // Not an interpretation input.
  }
  if (input && Array.isArray(input.classes) && Array.isArray(input.transcript)) {
    const records = answer(input);
    return { kind: 'interpretation', input, records, content: JSON.stringify(records) };
  }
  return { kind: 'other', input: null, records: [], content: 'OK.' };
}

/**
 * Starts the stub on a free port. Resolves with its base URL (ending in `/v1`, as an OpenAI client is
 * given one), the model name it answers to, every request it has answered (`calls`), and `close`.
 */
export async function startStubLlm({ model = 'coasys-spaces-stub' } = {}) {
  const calls = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname.replace(/\/+$/, '');
    if (req.method === 'GET' && (path === '/v1/models' || path === '/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: model, object: 'model', created: 0, owned_by: 'we' }] }));
      return;
    }
    if (req.method !== 'POST' || !(path === '/v1/chat/completions' || path === '/chat/completions')) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `No route ${req.method} ${path}` } }));
      return;
    }
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Body is not JSON' } }));
        return;
      }
      const answered = reply(body);
      calls.push({ at: Date.now(), kind: answered.kind, input: answered.input, records: answered.records });
      const id = `chatcmpl-stub-${calls.length}`;
      const created = Math.floor(Date.now() / 1000);
      const usage = {
        prompt_tokens: Math.ceil(raw.length / 4),
        completion_tokens: answered.content.length,
        total_tokens: 0,
      };
      usage.total_tokens = usage.prompt_tokens + usage.completion_tokens;
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const chunk = (delta, finish) =>
          `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model: body.model ?? model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
        res.write(chunk({ role: 'assistant', content: answered.content }, null));
        res.write(chunk({}, 'stop'));
        res.end('data: [DONE]\n\n');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id,
          object: 'chat.completion',
          created,
          model: body.model ?? model,
          choices: [{ index: 0, message: { role: 'assistant', content: answered.content }, finish_reason: 'stop' }],
          usage,
        }),
      );
    });
  });
  const port = await freePort();
  await new Promise((done) => server.listen(port, '127.0.0.1', done));
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    model,
    calls,
    /** The interpretation passes answered so far. */
    passes: () => calls.filter((c) => c.kind === 'interpretation'),
    close: () =>
      new Promise((done) => {
        // The executor's HTTP client keeps connections alive; without this, close waits on them.
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
