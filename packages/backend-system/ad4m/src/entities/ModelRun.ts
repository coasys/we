/**
 * GENERATED from src/manifest/ModelRun.ts — do not edit here.
 *
 * The manifest module is the source of truth: its schema, hints and prose. Rebuild with
 * `pnpm --filter @we/entities generate:classes` after changing it.
 */
import { Ad4mModel, Flag, Model, Property } from '@coasys/ad4m';

/**
 * One time a model was asked to do something on somebody's behalf, and how it went.
 *
 * ## Why a run is a record
 *
 * What a model writes is real, stored and queryable on its own; what is lost without this is
 * everything about the *asking*: whether it happened, when, who spent the tokens, which model, and
 * whether it failed. An extraction pass that failed and one that found nothing look the same from
 * the records alone, and so do a reply a model wrote and one a person typed. A run says which.
 *
 * ## One entity for every kind of run
 *
 * `kind` says what the model was doing (`extraction`, `transcription`, `chat`, `agent`, more as
 * writers appear),
 * and everything else is common: the model, what started it, how it ended. What only one kind
 * carries goes in {@link detail}, read whole by the surface that knows that kind. So a new writer
 * adds a kind, not an entity, and "everything a model did here" is one query.
 *
 * ## How it connects
 *
 * - What a run was about, a call or a template, holds it in its `runs` (`WeNode.runs`), so a
 *   panel open on one record reads its runs with the subject it reads everything else with.
 * - What a run made carries `generatedBy` (`WeNode.generatedBy`), written by whoever wrote the
 *   record, in the same write. For an extraction pass that is the backend, which alone knows which
 *   records the pass made rather than matched: the run is opened before the pass and named to it
 *   (`run` on the interpretation port).
 * - A change a run made to a record that already existed, and somebody kept, is an
 *   {@link Amendment}.
 *
 * Who asked is `author`, which every record carries, and when is `createdAt`.
 *
 * ## The exchange is here, and it is the expensive part
 *
 * {@link prompt} and {@link output} hold what was asked and answered, verbatim. In a shared space
 * that is every member replicating a second copy of a whole transcript, for a payload almost nobody
 * opens. They are written anyway where a writer opts in (extraction does), because a log that
 * omits what was asked cannot answer the question people have about a run: not "did it run" but
 * "why did it decide *that*".
 */
@Model({ name: 'ModelRun' })
export class ModelRun extends Ad4mModel {
  @Flag({ through: 'we://flag', value: 'we://model_run' })
  flag: string = '';

  /** What the model was doing: `extraction`, `transcription`, `chat`, `agent`. */
  @Property({ through: 'we://model_run_kind' })
  kind: string = '';

  /** The model, by the name the backend reports. Empty where it reported none. */
  @Property({ through: 'we://model_run_model' })
  model: string = '';

  /**
   * What started it — `manual` for somebody asking, `auto` for a standing watch.
   * Recording both is what makes one history rather than two: an extraction read by a watch and
   * one asked for by hand are otherwise told apart only by which panel happened to see them.
   */
  @Property({ through: 'we://trigger' })
  trigger: string = 'manual';

  /**
   * How it ended: `done`, `failed`, `skipped` (nothing to do), or, for a run something waits on,
   * `running`, `cancelled` or `interrupted`. Several rather than a boolean because they are
   * different things to say to somebody reviewing it: it ran, it tried and could not, it had
   * nothing to look for, it was stopped.
   */
  @Property({ through: 'we://outcome' })
  outcome: string = 'done';

  /** Why it failed, verbatim from the backend. Empty on any other outcome. */
  @Property({ through: 'we://error' })
  error: string = '';

  /**
   * How many records it made. `0` is a real answer and the common one on a short call.
   * Stored rather than counted afterwards, because records are not evidence of the run that made
   * them: a second extraction pass updates what the first found rather than duplicating it, so
   * counting attributes every record to whichever pass ran last.
   */
  @Property({ through: 'we://model_run_record_count' })
  recordCount: number = 0;

  /**
   * What only this kind of run carries, as JSON read whole: an extraction's `targets` (the
   * entity names it looked for), a chat reply's `steps`. A blob because it is never filtered
   * on, and because a relation per entry would be a handful of links per run for a list
   * nobody queries across.
   */
  @Property({ through: 'we://model_run_detail' })
  detail: string = '';

  /** What the model was asked, verbatim, where the writer keeps it. See the note above. */
  @Property({ through: 'we://prompt' })
  prompt: string = '';

  /** What the model answered, verbatim. Same rules as {@link prompt}. */
  @Property({ through: 'we://model_run_output' })
  output: string = '';
}
