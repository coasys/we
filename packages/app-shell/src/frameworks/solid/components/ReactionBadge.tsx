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
 *
 * ## Answering as somebody else
 *
 * In a development build a reader can act as one of the pretend people (see `pretendPeople`). A press
 * then records that person's answer on this device instead of writing a reaction — nothing can be
 * written as another agent — and the canvas seed, which is handed the same answers, re-weighs with it.
 */
import { Column, CountMark, Row, SignalControl, type SignalTypeData } from '@we/components/solid';
import { Signal, SignalType } from '@we/entities';
import type { GraphNode } from '@we/graph-protocol';
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';

import { actingAs, answerAs } from '../../../shared/pretendPeople';
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

export function ReactionBadge(props: {
  node: GraphNode;
  recordId?: string;
  recordType?: string;
  keepStill?: (on: boolean) => void;
}) {
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
  // The pretend person answered as, or empty — in which case every answer here is the reader's own.
  const pretend = () => actingAs();
  const held = () => (record() && typeId() && !pretend() ? signalOptimism.held(record(), typeId()) : undefined);

  // What the card says the reader gave is the evidence a held answer waits for — see `@we/optimism`.
  createEffect(() => {
    const read = weighed();
    // Not while acting: the card then reports the pretend person's answer, which is no evidence about ours.
    if (read && record() && !pretend()) signalOptimism.settleObserved(record(), typeId(), read.mine ?? null);
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
    if (pretend()) return answerAs(pretend(), record(), value);
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
  const answers = () => {
    const acting = pretend();
    if (!acting) {
      return reactions({
        signals: rows(),
        record: record(),
        type: typeId(),
        me: sessionStore.me()?.did,
        pending: signalOptimism.overlay(),
      }) as ReactionRow[];
    }
    // The pretend person's answer is the one the card reports — made up, or given while acting as them.
    const mine = weighed()?.mine;
    return mine === undefined ? rows() : [...rows(), { signalTypeId: typeId(), value: mine, author: acting }];
  };
  const answeringAs = () => pretend() || sessionStore.me()?.did;

  /*
    The card stays put while its popover is open. Somebody choosing a rating has left the badge for the
    popover, which ends the graph's own hold on the pointer — and a card that re-sorted to a new place
    mid-choice would carry the popover off with it. Watched on the element's own `open`, which it
    reflects, since the browser's toggle event does not leave its shadow root.
  */
  const watchOpen = (popover: HTMLElement) => {
    const observer = new MutationObserver(() => props.keepStill?.(popover.hasAttribute('open')));
    observer.observe(popover, { attributes: true, attributeFilter: ['open'] });
    onCleanup(() => {
      observer.disconnect();
      props.keepStill?.(false);
    });
  };

  const label = () => {
    const name = type()?.name || 'Reactions';
    if (score() === undefined) return `${name}: none yet`;
    // Said, so a score that moved when a voice was turned down is not read as people changing their minds.
    return weighed()?.adjusted ? `${name}: ${score()}, weighted` : `${name}: ${score()}`;
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
              <we-popover
                placement="top"
                // A callback ref, which Solid supports on any element; the generated declaration for this
                // one only admits the variable form.
                ref={watchOpen as unknown as HTMLElement}
              >
                <span slot="trigger" onPointerDown={() => void readRows()}>
                  <CountMark
                    icon={signalType().icon}
                    count={score()}
                    mine={mine()}
                    size="sm"
                    emphasis="present"
                    label={label()}
                  />
                </span>
                {/*
                  In the popover's `content` slot — it shows nothing else, and the control in its
                  default slot was never drawn, so a press on a slider's mark opened an empty panel.
                  Laid out as the kit's own reaction popover is: the reaction's name over its control.
                */}
                <div slot="content">
                  <Column bg="surface-raised" r="surface" p="400" gap="200" shadow="lg">
                    <we-text variant="label">{signalType().name}</we-text>
                    <SignalControl
                      signalType={signalType()}
                      signals={answers()}
                      myDid={answeringAs()}
                      onSignal={give}
                    />
                  </Column>
                </div>
              </we-popover>
            }
          >
            <CountMark
              icon={signalType().icon}
              count={score()}
              mine={mine()}
              size="sm"
              // The score is what a card's badge is read for; quiet, it all but vanished on the card.
              emphasis="present"
              label={label()}
              onPress={() => give(mine() ? null : signalType().rangeMax || 1)}
            />
          </Show>
        </Row>
      )}
    </Show>
  );
}
