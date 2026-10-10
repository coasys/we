/**
 * A line's mentions kept in step with its marks, as the host writes it.
 *
 * A module cannot see marks, so the host is the one place a transcript line's mention link can be
 * written — and the failure is silent both ways: a mention drawn on the line with no link behind it
 * wakes nobody and counts for nobody, and a link left behind after the name was edited away keeps
 * telling somebody they were mentioned.
 */
import { linkNewMentions, prepareMentionUpdate } from '@shared/lineMentions';
import { describe, expect, it } from 'vitest';

const ANN = 'did:key:ann';
const BEN = 'did:key:ben';
const mention = (start: number, end: number, did: string) => ({ start, end, type: 'mention', did });

function model(row: Record<string, unknown> | null = null) {
  const links: string[] = [];
  return {
    links,
    Model: {
      addRelation: async (_d: unknown, id: string, relation: string, target: string) => {
        links.push(`+${id}.${relation}=${target}`);
      },
      removeRelation: async (_d: unknown, id: string, relation: string, target: string) => {
        links.push(`-${id}.${relation}=${target}`);
      },
      findOne: async () => row,
    },
  };
}

describe('a line’s mentions', () => {
  it('links everybody a new line’s marks mention, once each', async () => {
    const { links, Model } = model();
    const marks = JSON.stringify([mention(0, 4, ANN), mention(9, 13, ANN), mention(14, 18, BEN)]);
    await linkNewMentions(Model, {}, 'TextBlock', 'line-1', { text: '@Ann and @Ann @Ben', marks });
    expect(links).toEqual([`+line-1.mentions=${ANN}`, `+line-1.mentions=${BEN}`]);
  });

  it('writes nothing for a line with no marks, or a record that is not a message', async () => {
    const { links, Model } = model();
    await linkNewMentions(Model, {}, 'TextBlock', 'line-1', { text: 'plain' });
    await linkNewMentions(Model, {}, 'TaskBlock', 'task-1', { marks: JSON.stringify([mention(0, 4, ANN)]) });
    expect(links).toEqual([]);
  });

  it('keeps a mention whose words an edit left alone, and drops the one it edited away', async () => {
    const { links, Model } = model({
      text: '@Ann and @Ben',
      marks: JSON.stringify([mention(0, 4, ANN), mention(9, 13, BEN)]),
      mentions: [ANN, BEN],
    });
    const { fields, after } = await prepareMentionUpdate(Model, {}, 'TextBlock', 'line-1', {
      text: '@Ann and nobody',
    });
    await after();
    expect(JSON.parse(String(fields.marks))).toEqual([mention(0, 4, ANN)]);
    expect(links).toEqual([`-line-1.mentions=${BEN}`]);
  });

  it('leaves an update that is not about the words alone', async () => {
    const { links, Model } = model({ text: 'x', marks: '', mentions: [] });
    const { fields, after } = await prepareMentionUpdate(Model, {}, 'TextBlock', 'line-1', { source: 'corrected' });
    await after();
    expect(fields).toEqual({ source: 'corrected' });
    expect(links).toEqual([]);
  });
});
