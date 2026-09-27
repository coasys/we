/**
 * People who are not there, answering on every card of a weighed canvas — for trying out how a voice
 * turned up or down reorders a tree without several real agents to answer with.
 *
 * ## Why they cannot be stored
 *
 * The backend signs every record with the key of the agent that wrote it, so there is no honest way to
 * write a reaction as somebody else — and a dishonest one would leave records in a shared space that
 * every member would see and nothing would clean up. So nothing here is written anywhere. The canvas
 * seed mixes these people's answers into the ones it read, just before it weighs them (see `Pretend` in
 * `@we/graph-expanders`), and everything downstream — the order, the heat map, the badges, the Voices
 * list — sees them as it would see real ones.
 *
 * ## What is kept
 *
 * How many there are, which of them the reader is acting as, and any answer given while acting as one.
 * In `localStorage`, so it survives the reloads done while iterating; on the canvas's own corner, so it
 * cannot be silently left on. Their other answers are made up from a hash of person and card, so they
 * are the same on every load without being stored.
 *
 * ## Gates
 *
 * The build decides whether any of this exists — `import.meta.env.DEV` is false in production, and the
 * bundler drops the control with it. `sessionStore.devTools` decides whether it shows, so a developer
 * looking at what a user sees loses the pretend people along with every other developer affordance.
 * Mirrors the call module's synthetic participants (`module-system/call/src/devPeers.ts`).
 */
import type { Pretend } from '@we/graph-expanders';
import { createSignal } from 'solid-js';

const STORAGE_KEY = 'we.graph.pretendPeople';

/** More than this is a stray keypress rather than a test. */
const MAX = 12;

const NAMES = ['Ada', 'Bo', 'Cai', 'Dee', 'Eli', 'Fen', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit', 'Lu'];

/** Whether any of this exists at all — the build, and nothing else. */
export const pretendPeopleAvailable = import.meta.env.DEV === true;

interface Stored {
  count: number;
  actingAs?: string;
  answers?: Record<string, number | null>;
}

function load(): Stored {
  if (!pretendPeopleAvailable) return { count: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Stored> | null;
    return {
      count: clamp(Number(raw?.count)),
      actingAs: typeof raw?.actingAs === 'string' ? raw.actingAs : undefined,
      answers: raw?.answers && typeof raw.answers === 'object' ? raw.answers : undefined,
    };
  } catch {
    return { count: 0 };
  }
}

function clamp(raw: number): number {
  return Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), MAX) : 0;
}

const [state, setState] = createSignal<Stored>(load());

function save(next: Stored) {
  setState(next);
  if (!pretendPeopleAvailable) return;
  try {
    if (!next.count && !next.answers) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage refused — the people still exist for this session.
  }
}

/** The pretend people, by id and name. */
export function pretendPeople(): { id: string; name: string }[] {
  return Array.from({ length: state().count }, (_, i) => ({
    id: `pretend:${i + 1}`,
    name: NAMES[i] ?? `Pretend ${i + 1}`,
  }));
}

/** What the canvas seed is handed, or undefined while there is nobody pretending. */
export function pretendSettings(): Pretend | undefined {
  const { count, actingAs, answers } = state();
  if (!count) return undefined;
  return { people: pretendPeople(), ...(answers ? { answers } : {}), ...(actingAs ? { actingAs } : {}) };
}

/** Which pretend person the reader is answering as, or empty for themselves. */
export function actingAs(): string {
  const { actingAs: id } = state();
  return id && pretendPeople().some((person) => person.id === id) ? id : '';
}

/** Change how many there are. One taken away who was being acted as hands the reader back to themselves. */
export function setPretendCount(count: number) {
  const next = clamp(count);
  const current = state();
  const acting = current.actingAs && Number(current.actingAs.split(':')[1]) <= next ? current.actingAs : undefined;
  save({ ...current, count: next, actingAs: acting });
}

/** Answer as one of them from now on — or as oneself, with an empty id. */
export function actAs(id: string) {
  save({ ...state(), actingAs: id || undefined });
}

/** Record what the pretend person being acted as gave on one card — null takes it back. */
export function answerAs(person: string, record: string, value: number | null) {
  const current = state();
  save({ ...current, answers: { ...current.answers, [`${person}|${record}`]: value } });
}

/** Forget every answer given while acting, so the made-up ones come back. */
export function forgetPretendAnswers() {
  save({ ...state(), answers: undefined });
}
