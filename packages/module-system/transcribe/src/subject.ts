/**
 * Which call a transcript surface is about, and whether that call is the one being recorded.
 *
 * Its own file because both halves are read by `Panel.schema` and by `ExtractionStatus.schema`, and
 * the import between those two already runs one way — the panel places the activity readout. A
 * constant defined in either and imported by the other would either be a cycle or would live in
 * whichever file happened not to need it.
 */

/**
 * The call on screen: the one the address names, else the one being recorded into.
 *
 * `collectionId` rather than the call module's record id: the collection is created on the first
 * utterance, so its absence is exactly "nothing has been said here", which is the question
 * `captureStatus` is already answering. A call with a record and no words is not a transcript.
 */
export const SUBJECT_EXPR = 'routeStore.params.call ? routeStore.params.call : modules.transcribe.collectionId';

/**
 * Whether the call on screen is the one being recorded, as opposed to one being looked back at.
 *
 * Everything about *this agent's microphone* is gated on it — the meter, the coverage readout, the
 * status notes, the unsaved line, the REC badge and the record button. A bar moving beside last
 * month's meeting would be measuring the wrong thing and saying so confidently.
 *
 * ## Naming a call is not the same as reading one back
 *
 * This used to be "the address names a call", and the two coincided for as long as the only way to
 * pick a call up was a button that cleared the parameter as it went. The module rail can now
 * continue the call on screen, which leaves the address naming it — so the panel called a meeting
 * in progress a past one, and hid the meter, the coverage readout, the unsaved line and the REC
 * badge for the rest of it.
 *
 * The honest question is whether the call named is the one being recorded, and this module can
 * answer it without naming another: `callId` is what it is about, falling back to the live call's
 * own record, so it is set from the moment a call is joined rather than from the first thing said.
 *
 * Read from the address rather than derived from `SUBJECT`, because whole-token substitution cannot
 * rewrite an expression that merely mentions the subject: a `$part` pointed at another call is
 * expected to be on a route that names it, which is what `SUBJECT_EXPR` already assumes.
 */
export const VIEWING_LIVE_EXPR = '!routeStore.params.call || routeStore.params.call == modules.transcribe.callId';
