import {
  exportFileName,
  type ExtractionLogInput,
  fenced,
  formatExtractionLog,
  plainFields,
  transcriptLine,
} from '@shared/interpretation/callExport';
import { describe, expect, it } from 'vitest';

const nameFor = (did: string) => (did === 'did:key:anna' ? 'Anna' : did);

const input = (overrides: Partial<ExtractionLogInput> = {}): ExtractionLogInput => ({
  callId: 'call-1',
  callTitle: 'Planning',
  exportedAt: new Date('2026-09-14T12:00:00.000Z'),
  callTargets: ['TaskBlock'],
  spaceTargets: ['TaskBlock', 'EventBlock'],
  autoInterpret: true,
  transcript: [{ speaker: 'did:key:anna', text: 'Ship it Friday', timestamp: '2026-09-14T11:00:00.000Z' }],
  passes: [],
  records: [],
  proposals: [],
  nameFor,
  ...overrides,
});

describe('the transcript line', () => {
  it('marks what was not spoken, and only that', () => {
    const turn = { speaker: 'did:key:anna', text: 'hi', timestamp: 't' };
    expect(transcriptLine(turn, nameFor)).toBe('Anna, t: hi');
    expect(transcriptLine({ ...turn, source: 'typed' }, nameFor)).toBe('Anna, t (typed): hi');
    expect(transcriptLine({ ...turn, source: 'corrected' }, nameFor)).toBe('Anna, t (corrected): hi');
  });
});

describe('the file name', () => {
  it('is the title without punctuation, stamped', () => {
    const at = new Date('2026-09-14T12:00:00.000Z');
    expect(exportFileName('Q3 / planning!', 'call', 'md', at)).toBe('Q3-planning-2026-09-14T12-00-00-000Z.md');
    expect(exportFileName('  ', 'call', 'txt', at)).toBe('call-2026-09-14T12-00-00-000Z.txt');
  });
});

describe('a fenced block', () => {
  it('outlasts any run of backticks inside it', () => {
    // A transcript can carry code somebody pasted, and the prompt carries the transcript.
    const block = fenced('before ```` after');
    expect(block.startsWith('`````\n')).toBe(true);
    expect(block.endsWith('\n`````')).toBe(true);
  });
});

describe('a stored record as data', () => {
  it('keeps what it says and drops the handles, the empties and the type tag', () => {
    const record = {
      _perspective: { circular: true },
      __subjectClass: 'TaskBlock',
      title: 'Ship it',
      status: '',
      comments: [],
      tags: ['a'],
      createdAt: Date.parse('2026-09-14T11:00:00.000Z'),
      get id() {
        return 'task-1';
      },
    };
    expect(plainFields(record)).toEqual({
      id: 'task-1',
      title: 'Ship it',
      tags: ['a'],
      createdAt: '2026-09-14T11:00:00.000Z',
    });
  });
});

describe('the extraction log', () => {
  it('lists passes oldest first with the prompt and response verbatim', () => {
    const log = formatExtractionLog(
      input({
        passes: [
          { createdAt: '2026-09-14T11:30:00.000Z', trigger: 'auto', prompt: 'second prompt', response: 'plain' },
          {
            createdAt: '2026-09-14T11:10:00.000Z',
            author: 'did:key:anna',
            trigger: 'manual',
            outcome: 'done',
            recordCount: 1,
            targets: '["TaskBlock"]',
            prompt: 'first prompt',
            response: '{"records":[]}',
          },
        ],
      }),
    );

    expect(log.indexOf('first prompt')).toBeLessThan(log.indexOf('second prompt'));
    expect(log).toContain('### Pass 1: 2026-09-14T11:10:00.000Z');
    expect(log).toContain('- Run by: Anna (`did:key:anna`)');
    expect(log).toContain('- Looking for: TaskBlock');
    // Pretty-printed and labelled only where it parsed.
    expect(log).toContain('```json\n{\n  "records": []\n}\n```');
    expect(log).toContain('```\nplain\n```');
  });

  it('carries the settings, the transcript once, the records and what is still waiting', () => {
    const log = formatExtractionLog(
      input({
        passes: [{ createdAt: '2026-09-14T11:10:00.000Z' }],
        records: [{ id: 'task-1', __subjectClass: 'TaskBlock', title: 'Ship it' }],
        proposals: [{ id: 'task-1', kind: 'create', entity: 'TaskBlock', values: { title: 'Ship it' } }],
      }),
    );

    expect(log).toContain('- Looking for, on this call: TaskBlock');
    expect(log).toContain('- Space default: TaskBlock, EventBlock');
    expect(log).toContain('Anna, 2026-09-14T11:00:00.000Z: Ship it Friday');
    expect(log).toContain('### TaskBlock: `task-1`');
    expect(log).toContain('- Awaiting a decision: yes');
    expect(log).toContain('### New TaskBlock: `task-1`');
    // A pass from before prompts were stored says so rather than showing an empty fence.
    expect(log).toContain('#### Prompt\n\n_Not recorded._');
  });
});
