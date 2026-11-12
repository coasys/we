/**
 * The chat's reads off a conversation — the UI state behind the badges and marks.
 *
 * - A reply still `running` is the working state: Stop in place of Send, no send affordance.
 * - A reply ended by the capability boundary is read as the real "Capability is not matched" — the
 *   line the frame shows — whether it arrived as the reply's error or on a refused step.
 * - The orange write mark is a step that *wrote and finished*: a write still running is not yet a
 *   change to mark, and a failed one never made it.
 * - A space chat's lock is the scope it was created with: present on its summary, absent on a
 *   global chat's.
 */
import type { AgentConversationMessage } from '@we/backend-shared';
import { isWroteStep, stepWords } from '@we/components/step-words';
import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_REFUSAL,
  lastAsk,
  refusalOf,
  replyRunning,
  unfinishedWords,
} from '../src/frameworks/solid/components/chat/chatState';

const msg = (partial: Partial<AgentConversationMessage>): AgentConversationMessage => ({
  id: 'm',
  role: 'user',
  text: '',
  createdAt: 0,
  ...partial,
});

describe('replyRunning — the working state that swaps Send for Stop', () => {
  it('is true only while an assistant row is running', () => {
    expect(replyRunning([msg({ role: 'user', text: 'q' }), msg({ role: 'assistant', status: 'running' })])).toBe(true);
    expect(replyRunning([msg({ role: 'user', text: 'q' }), msg({ role: 'assistant', status: 'done' })])).toBe(false);
    expect(replyRunning([msg({ role: 'user', text: 'q' })])).toBe(false);
  });
});

describe('refusalOf — the capability boundary, as the real error', () => {
  it('reads the refusal off a failed reply carrying the executor’s error', () => {
    const messages = [
      msg({ role: 'user', text: 'what is in the other space?' }),
      msg({ role: 'assistant', status: 'failed', error: `tool describe_perspective failed: ${CAPABILITY_REFUSAL}` }),
    ];
    expect(refusalOf(messages)).toBe(`tool describe_perspective failed: ${CAPABILITY_REFUSAL}`);
  });

  it('reads it off a refused step when the reply itself settled clean', () => {
    const messages = [
      msg({ role: 'user', text: 'q' }),
      msg({
        role: 'assistant',
        status: 'done',
        text: 'I cannot reach that.',
        steps: [{ tool: 'describe_perspective', outcome: 'error', error: CAPABILITY_REFUSAL, refused: true }],
      }),
    ];
    expect(refusalOf(messages)).toBe(CAPABILITY_REFUSAL);
  });

  it('is absent for an ordinary failure, a running reply, and no reply', () => {
    expect(refusalOf([msg({ role: 'assistant', status: 'failed', error: 'model exploded' })])).toBeNull();
    expect(refusalOf([msg({ role: 'assistant', status: 'running' })])).toBeNull();
    expect(refusalOf([msg({ role: 'user', text: 'q' })])).toBeNull();
  });
});

describe('the orange write mark', () => {
  it('is a call that wrote and finished — running and failed writes do not count', () => {
    expect(isWroteStep({ tool: 'instance_create', outcome: 'ok', wrote: true })).toBe(true);
    expect(isWroteStep({ tool: 'instance_create', outcome: 'running', wrote: true })).toBe(false);
    expect(isWroteStep({ tool: 'instance_create', outcome: 'error', wrote: true })).toBe(false);
    expect(isWroteStep({ tool: 'query_links', outcome: 'ok' })).toBe(false);
  });
});

describe('stepWords — a tool call in the chat’s words', () => {
  it('says doing while it runs and done once it has', () => {
    expect(stepWords({ tool: 'instance_create', outcome: 'running' })).toBe('Creating a record');
    expect(stepWords({ tool: 'instance_create', outcome: 'ok' })).toBe('Created a record');
    expect(stepWords({ tool: 'describe_perspective', outcome: 'ok' })).toBe('Looked at what this space holds');
    expect(stepWords({ tool: 'instance_create', outcome: 'stopped' })).toBe('Creating a record (stopped)');
    expect(stepWords({ tool: 'instance_create', outcome: 'error' })).toBe('Creating a record failed');
    expect(stepWords({ tool: 'a_tool_nobody_named', outcome: 'ok' })).toBe('Used a_tool_nobody_named');
  });
});

describe('the unfinished reply and its resend', () => {
  it('names the ending in words, and the question to send again', () => {
    expect(unfinishedWords('failed')).toBe('The reply failed');
    expect(unfinishedWords('cancelled')).toBe('Stopped');
    expect(unfinishedWords('interrupted')).toBe('Stopped when the node restarted');
    expect(
      lastAsk([
        msg({ role: 'user', text: 'first' }),
        msg({ role: 'assistant', status: 'done' }),
        msg({ role: 'user', text: 'second' }),
        msg({ role: 'assistant', status: 'failed' }),
      ]),
    ).toBe('second');
  });
});
