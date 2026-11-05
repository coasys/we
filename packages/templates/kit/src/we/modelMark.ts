import type { SchemaNode } from '@we/schema-shared';

/**
 * A sparkle on a record a model made, saying where it came from when somebody hovers it.
 *
 * Whether a model made it is `generatedRun`'s to say, so every surface draws the same records as
 * model-made: a task an extraction pass wrote, an event the agent added from a chat, anything else a
 * run marks in the future. A record a person made has nothing unusual to explain, and draws nothing.
 *
 * The words name what kind of making it was where the record says: extracted from a conversation
 * when it carries `extractedFrom`, otherwise written by AI. "Run by" is the record's author, which
 * for model-made work is whoever's node did the running, not whoever proposed the work.
 *
 * `extracted` widens the mark to records a caller knows came out of a conversation without a run
 * naming them, which is what a pass a standing watch runs writes today.
 */
export function modelMark(opts: { as: string; extracted?: string }): SchemaNode {
  const { as } = opts;
  const generated = `generatedRun({ record: ${as} })`;
  return {
    type: '$if',
    props: {
      condition: { $: opts.extracted ? `${generated} || (${opts.extracted})` : generated },
      then: {
        type: 'we-tooltip',
        props: { placement: 'top' },
        children: [
          {
            // A native element carries the slot — see `peopleTooltip` for why a Column cannot.
            type: 'div',
            slot: 'content',
            children: [
              {
                type: '$agent',
                props: { did: { $: `${as}.author` }, as: 'author' },
                children: [
                  {
                    type: 'Row',
                    props: { gap: '100', ay: 'center', wrap: true },
                    children: [
                      {
                        type: 'we-text',
                        props: {
                          fontSize: '200',
                          text: {
                            $:
                              `\`\${${as}.extractedFrom ? 'Extracted from the conversation' : 'Written by AI'}` +
                              " · run by ${author.did == me.did ? 'you' : author.name}`",
                          },
                        },
                      },
                      {
                        type: 'we-timestamp',
                        props: { value: { $: `${as}.createdAt` }, relative: true, fontSize: '200' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { type: 'we-icon', props: { name: 'sparkle', size: 'xs', color: 'text-muted' } },
        ],
      },
    },
  };
}
