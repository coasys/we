/**
 * A card's score for the reaction a tree is ordered by, pressed to give, change or take back one's own.
 *
 * The `reaction` badge a workshop tree names while it is ordered by a reaction — see `NodeStyle.badge`.
 * Until it existed, reacting meant opening a card in the inspector, one card at a time, while the thing
 * being decided — which card belongs where — was the row of cards on the canvas.
 *
 * ## One mark, and it is the control
 *
 * The score is the button, the way a feed's like count is. A like is pressed and that is all: on, off,
 * nothing else appears. A vote, a rating or a slider holds more than one value and will not fit on a
 * card that may be a small ellipse, so pressing its mark opens the same control the inspector uses, in
 * a popover above the card, which escapes the card's clip and the canvas's transform.
 *
 * ## What it draws from
 *
 * The weighing the canvas seed put on the card — the score, how many people gave it, how it was read and
 * what the reader gave — with this agent's own answer in place from the moment of the press, through the
 * same hold every other reaction surface uses. Nothing is fetched to draw it, which is what lets a tree of
 * a hundred cards carry a hundred of them. The popover reads the card's reactions when it is opened,
 * because the control shows every answer and the card carries only the total.
 */
import { CountMark, Row, SignalControl, type SignalTypeData } from '@we/components/solid';
import { Signal, SignalType } from '@we/entities';
import type { GraphNode } from '@we/graph-protocol';
import { createEffect, createMemo, createSignal, Show } from 'solid-js';

import { readWeighed, roundScore, withHeld } from '../../../shared/reactionScore';
import { signalOptimism } from '../../../shared/signalOptimism';
import { reactions } from '../../../shared/sources/signalTally';
import { useDatasetStore } from '../stores/DatasetStore';
import { useSessionStore } from '../stores/SessionStore';
import { useSpaceStore } from '../stores/SpaceStore';

type TypeRow = SignalTypeData & { id: string; name?: string };
type ReactionRow = { signalTypeId: string; value: number; author: string };

/**
 * Reaction types by dataset and id, read once each.
 *
 * Every badge on a canvas names the same type, so one read answers all of them; and a type is a
 * community's vocabulary, which changes about as often as somebody opens Settings.
 */
const typeReads = new Map<string, Promise<TypeRow | null>>();

function readType(handle: unknown, datasetId: string, id: string): Promise<TypeRow | null> {
  const key = `${datasetId}\u0000${id}`;
  let read = typeReads.get(key);
  if (!read) {
    read = (SignalType.findOne(handle as never, { where: { id } } as never) as Promise<unknown>)
      .then((row) => (row ? (row as TypeRow) : null))
      .catch(() => null);
    typeReads.set(key, read);
  }
  return read;
}

export function ReactionBadge(props: { node: GraphNode; recordId?: string; recordType?: string }) {
  const datasetStore = useDatasetStore();
  const sessionStore = useSessionStore();
  const spaceStore = useSpaceStore();

  const typeId = () => {
    const value = props.node.data?.weightType;
    return typeof value === 'string' ? value : '';
  };
  const record = () => props.recordId ?? '';

  const [type, setType] = createSignal<TypeRow | null>(null);
  createEffect(() => {
    const dataset = datasetStore.currentDataset();
    const id = typeId();
    if (!dataset || !id) return setType(null);
    void readType(dataset.handle, dataset.id, id).then((row) => {
      if (typeId() === id) setType(row);
    });
  });

  const weighed = createMemo(() => readWeighed(props.node.data as Record<string, unknown> | undefined, typeId()));
  const held = () => (record() && typeId() ? signalOptimism.held(record(), typeId()) : undefined);

  // What the card says the reader gave is the evidence a held answer waits for — see `@we/optimism`.
  createEffect(() => {
    const read = weighed();
    if (read && record()) signalOptimism.settleObserved(record(), typeId(), read.mine ?? null);
  });

  const shown = createMemo(() => {
    const read = weighed();
    return read ? withHeld(read, held()) : null;
  });
  const score = () => {
    const read = weighed();
    const value = shown()?.score;
    return read && value !== undefined ? roundScore(value, read.aggregate) : undefined;
  };
  const mine = () => shown()?.mine !== undefined;

  const give = (value: number | null) => {
    if (!record() || !typeId()) return;
    void spaceStore.upsertSignal(record(), typeId(), value);
  };

  /*
    Everybody's answers, for the control a vote or a rating opens — read when it is pressed rather than
    held for every card, since only the one being answered needs them.
  */
  const [rows, setRows] = createSignal<ReactionRow[]>([]);
  const readRows = async () => {
    const dataset = datasetStore.currentDataset();
    if (!dataset || !record()) return;
    const muted = new Set(spaceStore.mutedDids());
    const found = (await Signal.findAll(
      dataset.handle as never,
      {
        parent: { id: record(), predicate: 'we://signal' },
      } as never,
    )) as unknown as ReactionRow[];
    setRows(
      found
        .filter((row) => row.signalTypeId === typeId() && !muted.has(row.author))
        .map((row) => ({ signalTypeId: row.signalTypeId, value: Number(row.value), author: row.author })),
    );
  };
  const answers = () =>
    reactions({
      signals: rows(),
      record: record(),
      type: typeId(),
      me: sessionStore.me()?.did,
      pending: signalOptimism.overlay(),
    }) as ReactionRow[];

  const label = () => {
    const name = type()?.name || 'Reactions';
    return score() === undefined ? `${name}: none yet` : `${name}: ${score()}`;
  };

  return (
    <Show when={type()}>
      {(signalType) => (
        <Row
          class="reaction-badge"
          ay="center"
          bg="surface"
          border="1px solid border"
          r="pill"
          px="200"
          py="100"
          shadow="sm"
        >
          <Show
            when={signalType().mode === 'toggle'}
            fallback={
              <we-popover placement="top">
                <span slot="trigger" onPointerDown={() => void readRows()}>
                  <CountMark icon={signalType().icon} count={score()} mine={mine()} size="sm" label={label()} />
                </span>
                <Row p="200" gap="200" ay="center">
                  <SignalControl
                    signalType={signalType()}
                    signals={answers()}
                    myDid={sessionStore.me()?.did}
                    onSignal={give}
                  />
                </Row>
              </we-popover>
            }
          >
            <CountMark
              icon={signalType().icon}
              count={score()}
              mine={mine()}
              size="sm"
              label={label()}
              onPress={() => give(mine() ? null : signalType().rangeMax || 1)}
            />
          </Show>
        </Row>
      )}
    </Show>
  );
}
