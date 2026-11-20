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

describe('a refused step inside a space chat — foreign reach or boundary doing its job', () => {
  const SPACE = '11111111-2222-3333-4444-555555555555';
  const OTHER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const replied = (error: string) => [
    msg({ role: 'user', text: 'who am I here?' }),
    msg({
      role: 'assistant',
      status: 'done',
      text: 'You are Ada.',
      steps: [{ tool: 'agent_who_am_i', outcome: 'error', error, refused: true }],
    }),
  ];

  it('shows the card only when the refused step reached past the space on screen', () => {
    // A step refused for an agent-wide tool names no perspective — the reply answered anyway.
    expect(refusalOf(replied('Capability is not matched: agent'), SPACE)).toBeNull();
    // A step refused for the space's own perspective is the boundary in the right place.
    expect(refusalOf(replied(`capability domain perspective pointer ${SPACE} is not covered`), SPACE)).toBeNull();
    // Naming another space is the reach the card describes.
    expect(refusalOf(replied(`capability domain perspective pointer ${OTHER} is not covered`), SPACE)).toBe(
      `capability domain perspective pointer ${OTHER} is not covered`,
    );
  });

  it("reads the step's target before its error — the executor dumps the session's own capabilities into the error", () => {
    // The live refusal: describe_perspective aimed at another space failed, and the error text
    // only ever named the chat's own perspective. Reading the error alone never showed the card.
    const messages = [
      msg({ role: 'user', text: 'look at the other space' }),
      msg({
        role: 'assistant',
        status: 'done',
        steps: [
          {
            tool: 'describe_perspective',
            outcome: 'error',
            refused: true,
            target: OTHER,
            error: `Capability is not matched, you have capabilities: [domain perspective pointer ${SPACE}]`,
          },
        ],
      }),
    ];
    expect(refusalOf(messages, SPACE)).toBe(
      `Capability is not matched, you have capabilities: [domain perspective pointer ${SPACE}]`,
    );
  });

  it('shows it for a reply the backend flagged refused, whichever space it sat in', () => {
    const messages = [
      msg({ role: 'user', text: 'q' }),
      msg({ role: 'assistant', status: 'failed', refused: true, error: CAPABILITY_REFUSAL }),
    ];
    expect(refusalOf(messages, SPACE)).toBe(CAPABILITY_REFUSAL);
    expect(refusalOf(messages)).toBe(CAPABILITY_REFUSAL);
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
