/**
 * The transcription panel's shape — the decisions in it that are easy to undo by accident.
 *
 * Most of these assertions lived in `@we/template-showcase`'s tests, because the workshop template
 * used to supply a transcript panel of its own and they were checking that copy. The copy is gone
 * and the behaviour it existed for — following the call the address names — is here now, so the
 * tests are too. That relocation is the point: there is one transcript panel, and one place that
 * says what it must do.
 *
 * Serialised and searched rather than walked, the same way the showcase templates are tested. A
 * schema is data; what matters is whether the token is in the tree, not the path it sits at.
 */
import { markAction, markState, storeSurface } from '@we/module-shared';
import { SECTION_LABEL_PROPS } from '@we/schema-kit';
import { evaluateExpression, markReactive, namespace, parseCached, type SchemaNode } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { extractionActivity } from './ExtractionStatus.schema';
import { transcribeModule } from './index';
import {
  captureMeter,
  captureStatus,
  coverage,
  EXTRACTION_SUBJECT_EXPR,
  extractionPanel,
  extractionTargets,
  panel,
  pendingUtterance,
  SUBJECT_EXPR,
  transcriptComposer,
  transcriptFeed,
  transcriptLines,
} from './Panel.schema';
import { createTranscribeStore } from './store';
import { VIEWING_LIVE_EXPR } from './subject';

const panelJson = JSON.stringify(panel);
const feedJson = JSON.stringify(transcriptFeed);
const linesJson = JSON.stringify(transcriptLines);

/**
 * The store with nothing lent to it — no kernels, no effects — which is enough to read its surface.
 *
 * Which members are public is decided at construction and depends on nothing the host supplies, so
 * the smallest deps the contract admits answer the question; a fuller harness lives in `store.test`.
 */
function bareStore() {
  return createTranscribeStore({
    signal: <T>(initial: T): [() => T, (next: T) => void] => {
      let value = initial;
      return [() => value, (next: T) => (value = next)];
    },
    state: markState,
    action: markAction,
    kernels: {},
  });
}

describe('the module declaration', () => {
  it('names exactly the kernels the store reaches', () => {
    // A kernel not named is absent from the bag, and the store degrades rather than throws — so a
    // missing name here is a feature silently switched off, not a type error.
    expect(transcribeModule.manifest.requires?.kernels).toEqual([
      'records',
      'presence',
      'media',
      'transcription',
      'interpretation',
    ]);
    expect(transcribeModule.manifest.requires?.permissions).toEqual(['microphone']);
  });

  it('keeps its chrome on screen while recording, by a bare store key', () => {
    // Recording follows the call and the call survives navigation; the key is `enabled`, which goes
    // false the moment recording stops, so the hold cannot become permanent.
    expect(transcribeModule.contributes?.holds).toBe('enabled');
    expect(storeSurface(bareStore()).enabled?.kind).toBe('state');
  });

  it('owns whether each panel is open, and names how to open and close it', () => {
    /*
      The exception the contract describes rather than the default it offers. The store opens the
      transcript on a record press and the extraction panel when a pass starts, and reads `open` to
      keep polling for a model — none of which a host-held flag would let it do. Owning the flag
      means owning `show` and `close` too, or the rail and the titlebar have nothing to call.
    */
    const panels = transcribeModule.contributes?.panels ?? [];
    const surface = storeSurface(bareStore());

    expect(panels.map((p) => p.name)).toEqual(['transcript', 'extraction']);
    for (const p of panels) {
      expect(p.icon).toBeTruthy();
      expect(surface[p.open ?? '']?.kind).toBe('state');
      expect(surface[p.show ?? '']?.kind).toBe('action');
      expect(surface[p.close ?? '']?.kind).toBe('action');
    }
    // The rail spins on it while any peer's pass runs — the glance the call bar's square used to give.
    expect(surface[panels[1].busyWhen ?? '']?.kind).toBe('state');
    // And no launchers of its own: a panel's rail button is derived from the panel.
    expect(transcribeModule.contributes?.launchers).toBeUndefined();
  });

  it('marks every member its own fragments name, so a placed part can still read it', () => {
    /*
      Members are private by default now. The module's own panel renders against the chrome bag and
      would see a private member; a *part* placed by a template may not — so a fragment naming an
      unmarked member is a fragment that works in the default panel and renders nothing everywhere
      the parts exist to be placed.
    */
    const referenced = new Set<string>();
    for (const match of JSON.stringify(transcribeModule.contributes).matchAll(/modules\.transcribe\.([A-Za-z_]+)/g)) {
      referenced.add(match[1]);
    }
    const surface = storeSurface(bareStore());

    expect(referenced.size).toBeGreaterThan(20);
    expect([...referenced].filter((name) => !surface[name])).toEqual([]);
  });
});

describe('which call the panel is about', () => {
  it('follows the call the address names, and falls back to the one being recorded', () => {
    /*
      A transcript surface has always had two possible subjects and used to admit to one. The
      workshop template answered that by supplying a whole panel body of its own, which bought
      route-awareness at the price of a second copy of the header, the feed and the gating — and the
      copy drifted, never gaining the coverage readout or the capture status.
    */
    expect(feedJson).toContain(SUBJECT_EXPR);
    expect(SUBJECT_EXPR).toContain('routeStore.params.call');
    expect(SUBJECT_EXPR).toContain('modules.transcribe.collectionId');
  });

  it('publishes the feed under the subject token that is actually in its tree', () => {
    /*
      `$part` substitution is whole-token: a `subject` naming an expression that does not appear
      verbatim in the node rewrites nothing and does so silently, so a template pointing the feed at
      another call would get the live one and no complaint. Naming the bare collection id here — as
      this did before the feed became route-aware — is exactly that failure.
    */
    const declared = transcribeModule.contributes?.parts?.transcriptFeed;
    const subject = typeof declared === 'object' && 'subject' in declared ? declared.subject : undefined;

    expect(subject).toBe(SUBJECT_EXPR);
    expect(feedJson).toContain(subject);
  });

  it('says what the panel is, not which call it is about', () => {
    /*
      It used to say "Past call" when the address named one, which was the heading answering a
      question nothing else could: before the pill above it, the panel's own title was the only
      thing naming the conversation. The pill names it and says who was in it, so a title that
      changes as you move between calls is one that has to be re-read to learn nothing.
    */
    // `panelShell` paints its title into a `we-text`, so what is asserted is the heading it renders
    // rather than the prop handed to it — and that it is a plain string, not a branch.
    expect(panelJson).toContain('"children":["Transcript"]');
    expect(panelJson).not.toContain('Past call');
  });
});

describe('a transcript with nothing in it', () => {
  it('says so, rather than showing an empty panel', () => {
    expect(linesJson).toContain('Nothing has been said here yet.');
  });

  it('stops saying so the moment something is being said', () => {
    /*
      The unsaved preview is the first thing that happens on a new call: somebody speaks, the buffer
      appears, and the record still holds nothing — so "Nothing has been said here yet." sat directly
      above the words being said, which is two claims about one moment and one of them false.

      It also cost the handover its footing. The placeholder sits above the preview, so a line
      saving took the placeholder and the preview away together while the row arrived, and the
      column moved twice on the way.

      Gated on the same expression the preview gates itself on, so the two cannot disagree about
      whether there is a preview — and reversible for nothing: a buffer that never saves takes the
      placeholder's reason with it and the sentence comes back.
    */
    expect(linesJson).toContain(`!(modules.transcribe.heard && (${VIEWING_LIVE_EXPR}))`);
  });

  it('waits for the query to answer before asserting emptiness', () => {
    /*
      A list backed by a query is empty on its first frame, so an unqualified else claims "nothing
      here" about a transcript that is still arriving — which on a long one is the wrong sentence
      for as long as it takes to fetch.
    */
    expect(linesJson).toContain('local.utterancesLoaded');
  });

  it('gates on the flag alone, naming no subject a `$part` would have to rewrite', () => {
    /*
      THE regression, and one the assertion above cannot catch: it was
      `local.utterancesLoaded && modules.transcribe.collectionId`, which contains that string and
      still never showed the placeholder on the transcripts it was written for.

      Substitution is whole-token — `moduleParts` rewrites a `{ $ }` whose expression IS the
      subject, and leaves one that merely mentions it inside a longer sentence alone, deliberately,
      since half-rewriting somebody's sentence produces one nobody wrote. So a compound condition
      goes on reading the LIVE collection id, which is null on a past call: the panel gated itself
      shut exactly where an empty state was the whole point.

      Nothing is lost by dropping the term — `when` (asserted below) refuses the query without a
      subject, and a query never asked never reports itself loaded.
    */
    expect(linesJson).toContain('"condition":{"$":"local.utterancesLoaded"}');
    expect(linesJson).not.toContain('local.utterancesLoaded &&');
  });

  it('shows the placeholder where there is no record to wait for, not only where one answered empty', () => {
    /*
      The two situations a newcomer is most likely to be in — no call, and a call nobody has spoken
      in — left the panel blank. `when` refuses the query without a subject and a query never asked
      never reports itself loaded, so the one gate that existed was false in exactly those states.
      The bare subject token is the outer gate now, and it has to stay bare: substitution is
      whole-token, so a compound one would go on reading the live collection inside a panel about a
      past call.
    */
    const gate = linesJson.indexOf('"condition":{"$":"modules.transcribe.collectionId"}');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(linesJson.indexOf('"condition":{"$":"local.utterancesLoaded"}'));
  });

  it('says what to do next, which is different in each of the six situations', () => {
    /*
      "Nothing has been said here yet" is true in five of them and useless on its own. The panel is
      the only thing that knows which, and the no-call case used to be an italic caption in
      `captureStatus` — above the feed rather than in it, so the same emptiness looked like two
      different things depending on whether an address named a call.
    */
    expect(linesJson).toContain('Continue the call to begin transcribing.');
    expect(linesJson).toContain('Join a call to transcribe what is said.');
    // Named for the button it points at: it reads "Transcribe" now, not "record".
    expect(linesJson).toContain('Press Transcribe to write down what is said.');
    expect(linesJson).not.toContain('Press record');
    // Gone from the status notes, which are about what this node *cannot* do.
    expect(JSON.stringify(captureStatus)).not.toContain('press record');
  });

  it('changes the sentence by remounting it, so continuing a call fades rather than snaps', () => {
    /*
      Kept as one node with a six-branch expression, the text swapped in place with no transition —
      the one moment in this panel that still read as a jump, since switching between calls already
      fades because the branch it lives in unmounts. Split on the live test, continuing does too.
    */
    const gate = linesJson.indexOf(`"condition":{"$":"${VIEWING_LIVE_EXPR}"}`);
    expect(gate).toBeGreaterThan(-1);
    expect(linesJson.slice(gate)).toContain('"enterTransition":{"type":"fade"');
  });

  it('fades out over less time than the microphone section takes to leave', () => {
    /*
      The ordering the whole thing rests on. The renderer keeps an outgoing branch mounted for the
      length of its exit, so a sentence fading here is on screen while the section above it is
      going — and that section vanishing pulled it up the panel mid-fade. Making this exit instant
      did not help: the opacity change lands a frame or two after the condition, so the sentence was
      still painted for the collapse.

      So the section holds its box for longer than this takes, and the order becomes: sentence
      finishes, height goes, new sentence arrives where it will stay. Asserted as the comparison
      rather than as two numbers, because it is the relationship that matters.
    */
    const exitOf = (json: string, from: number) => {
      const at = json.indexOf('"exitTransition":{"type":"fade","duration":', from);
      return at === -1 ? -1 : Number(json.slice(at).match(/"duration":(\d+)/)?.[1]);
    };
    const gate = linesJson.indexOf(`"condition":{"$":"${VIEWING_LIVE_EXPR}"}`);
    const placeholder = exitOf(linesJson, gate);
    const section = exitOf(JSON.stringify(captureMeter), 0);

    expect(placeholder).toBeGreaterThan(0);
    expect(section).toBeGreaterThan(placeholder);
  });

  it('fades the microphone section out rather than collapsing it, and does so at every level', () => {
    /*
      A fade holds the box while it goes transparent; a reveal would collapse the height, which is
      the thing being avoided. All three carry it — the section's own fade holds nothing if its
      children have already unmounted from inside it.
    */
    for (const part of [captureMeter, coverage]) {
      expect(JSON.stringify(part)).toContain('"exitTransition":{"type":"fade","duration":300}');
      expect(JSON.stringify(part)).not.toContain('"type":"reveal"');
    }
    // And the box around them, which has to outlast its contents or it cuts their fades short.
    const section = panelJson.indexOf(`(${VIEWING_LIVE_EXPR}) && (modules.transcribe.enabled`);
    expect(panelJson.slice(section)).toContain('"exitTransition":{"type":"fade","duration":300}');
  });

  it('promises a pick-up only where one is on offer', () => {
    /*
      Another call already running is the state where nothing — not this panel's button, not the
      rail — will continue the one on screen, because doing so would re-point every peer's
      transcript. A clause telling somebody to continue a meeting that nothing will continue is
      worse than no clause, so it is tested before the two that make the offer.
    */
    const refuses = linesJson.indexOf('(!modules.call || modules.transcribe.inCall)');
    expect(refuses).toBeGreaterThan(-1);
    expect(refuses).toBeLessThan(linesJson.indexOf('Continue the call to begin transcribing.'));
    // Read off this module's own store, derived from presence — never off the call module's members.
    expect(linesJson).not.toContain('modules.call.');
    // And the same verb the button uses, decided by the same expression.
    expect(linesJson).toContain('Join the call to begin transcribing.');
  });

  it('asks only about the call on screen, however slowly its id arrives', () => {
    /*
      The hazard the hoist introduced and `when` closes: an operand that has not resolved is pruned
      rather than sent, and pruning WIDENS — a scope that lost its anchor asks for every TextBlock
      in the space. The `$if` that used to wrap the query stood in for this by never rendering it.
    */
    expect(linesJson).toContain('"when":{"$":"modules.transcribe.collectionId"}');
  });
});

describe('what belongs to the live microphone only', () => {
  it('keeps the meter, the coverage readout and the status notes off a call being read back', () => {
    // All three are about the microphone this agent is running now, which says nothing about a
    // meeting somebody opened from a link. A bar moving beside it would measure the wrong thing.
    const live = '{"$":"!routeStore.params.call || routeStore.params.call == modules.transcribe.callId"}';
    const meter = panelJson.indexOf('"Microphone"');
    const coverage = panelJson.indexOf('"Coverage"');
    // Any of the status notes will do as the marker; this is the first of them.
    const status = panelJson.indexOf('Nothing to listen to');

    // All three inside one gate rather than three of their own: they answer one question between
    // them, and that question is not asked at all of a meeting somebody is reading back.
    const gate = panelJson.lastIndexOf(live, meter);
    expect(gate).toBeGreaterThan(-1);
    expect(coverage).toBeGreaterThan(meter);
    expect(status).toBeGreaterThan(coverage);
    expect(panelJson.lastIndexOf(live, status)).toBe(gate);
  });

  it('draws no box for the microphone section while it has nothing to put in it', () => {
    /*
      A `Column` with nothing in it is still a flex item, so an empty one costs its parent a whole
      gap. All three of its children are dark for the second between joining a call and the
      microphone coming up, so continuing pushed the transcript down by twelve pixels of nothing,
      and then down again as the meter arrived.

      Both terms answer in the frame a call is torn down in, which is the point — see below.
    */
    expect(panelJson).toContain(
      `(${VIEWING_LIVE_EXPR}) && (modules.transcribe.enabled || modules.transcribe.available)`,
    );
  });

  it('gates that box on signals, not on a status written a round trip late', () => {
    /*
      It was `available || status != 'idle'`. `status` is set at the tail of `stop`, after a flush
      that writes buffered text to the backend — so leaving a call split across two repaints: audio
      went, coverage left, recording stopped, the meter left, and the box stayed up holding an empty
      gap until the flush resolved, then collapsed under a placeholder that had already settled.

      `enabled` and `available` are plain signals, so the section leaves with everything else.
    */
    const gate = panelJson.indexOf(`(${VIEWING_LIVE_EXPR}) && (modules.transcribe.enabled`);

    expect(gate).toBeGreaterThan(-1);
    expect(panelJson).not.toContain("modules.transcribe.status != 'idle'");
  });

  it('waits for a microphone before reporting coverage, so a gap that closes itself is never drawn', () => {
    /*
      Joining is a second in which all of this is true and wrong: you are in the call and your own
      microphone is not up, so it read "0 of 1 transcribing" in warning orange with the line under
      it about only those microphones reaching the record. Both resolved before anybody could read
      them, and the line arriving and then leaving moved everything below it twice.

      `available` separates the two states that look alike: no audio is a session still coming up
      and nothing to report; audio with no recording is somebody's decision, which is exactly when
      a gap is worth stating. A delayed fade was tried first and was worse — `$animate` keeps its
      child mounted and a fade only touches opacity, so the readout held its full height while
      invisible and the panel opened a hole before filling it in.
    */
    const readout = JSON.stringify(coverage);

    expect(readout).toContain('count(modules.transcribe.callAgents) && modules.transcribe.available');
    expect(readout).not.toContain('$animate');
  });

  it('states the gap in the count alone, with no sentence under it', () => {
    /*
      There was a second line while the count was short: "Only what those microphones hear reaches
      this record." Wrong as well as wordy — this panel has a composer, and a typed line is in the
      record without any microphone hearing it, so the sentence overstated the gap in a panel that
      offers the very thing it forgot.

      The colour is the warning. It turns from success to warning when somebody is not being
      transcribed, and a sentence explaining a number is the kind of chrome people stop reading
      before the day it matters.
    */
    const readout = JSON.stringify(coverage);

    expect(readout).not.toContain('microphones hear');
    expect(readout).toContain("modules.transcribe.partialCoverage ? 'warning-text' : 'success-text'");
  });

  it('keeps the meter up while switched off, and says so rather than going', () => {
    /*
      It was gated on `enabled`, so pressing stop mid-call took the whole meter out and everything
      below it jumped up the panel — worst where there is most to lose, since a long transcript's
      rows move under the eye reading them. It holds the box and reports the state instead.

      The glyph is in both states rather than appearing when off, which is what makes the row's
      height identical by construction rather than dependent on a 16px mark fitting a footnote's
      line box.
    */
    const meter = JSON.stringify(captureMeter);

    expect(meter).toContain('modules.transcribe.enabled || modules.transcribe.available');
    expect(meter).toContain("modules.transcribe.enabled ? 'microphone' : 'microphone-slash'");
    expect(meter).toContain("!modules.transcribe.enabled ? 'off'");
  });

  it('empties the bar when it is not listening, rather than freezing the last reading', () => {
    /*
      `levelPercent` is live and the audio graph is torn down on stop, so the last value before it
      went describes a moment that has passed. Left painted, the bar reports sound nobody is
      listening to.
    */
    expect(JSON.stringify(captureMeter)).toContain(
      "modules.transcribe.enabled ? modules.transcribe.levelPercent : '0%'",
    );
  });

  it('never animates the height of the microphone section, in either direction', () => {
    /*
      The invariant the whole arrangement rests on. A fade changes only opacity, so the box is held
      throughout; a `reveal` animates the height, which is the thing that must not move while
      anything else on screen is mid-transition. The meter carried one for a day, to soften pushing
      the readout down — and the two wait on the same fact now, so there was nothing to push.
    */
    const section = panelJson.indexOf(`(${VIEWING_LIVE_EXPR}) && (modules.transcribe.enabled`);

    for (const json of [JSON.stringify(captureMeter), JSON.stringify(coverage), panelJson.slice(section)]) {
      expect(json).toContain('"enterTransition":{"type":"fade","duration":300}');
      expect(json).not.toContain('"type":"reveal"');
    }
  });

  it('says nothing about starting up, in the meter or beside it', () => {
    /*
      A spinner and "Starting…" appeared under the meter for the few hundred milliseconds an audio
      graph takes to open, then vanished — a whole line arriving and leaving under a meter that had
      just arrived itself. Folding it into the meter's own label cost no layout but still changed a
      word nobody could read into another one.

      "quiet" is already true while a stream comes up: the bar is at zero because nothing has been
      heard, which is what it means a second later too. One stable word beats a narrated setup.
    */
    const meter = JSON.stringify(captureMeter);

    expect(meter).toContain("modules.transcribe.speaking ? 'hearing you' : 'quiet'");
    expect(meter).not.toContain('starting');
    expect(JSON.stringify(captureStatus)).not.toContain('we-spinner');
  });

  it('gates the unsaved line itself, rather than leaving that to whoever places it', () => {
    /*
      The buffer is this agent's own microphone. A fragment that has to be wrapped in the right
      condition by its consumer is a fragment that will be placed without one — the workshop wrapped
      it by hand, and nothing would have said so if it had been forgotten.
    */
    expect(JSON.stringify(pendingUtterance)).toContain(
      'modules.transcribe.heard && (!routeStore.params.call || routeStore.params.call == modules.transcribe.callId)',
    );
  });

  it('leaves the record button out where it could not work, rather than showing a dead one', () => {
    /*
      It was a `disabled`, true in exactly one situation: outside a call, where there is no audio.
      So the control sat greyed out in the header of every panel opened outside a call — the state a
      newcomer opens it in — beside a placeholder already explaining that a call is what is missing.

      `enabled ||` is what keeps the way *out* of recording: a stream dropping mid-call must not
      take the stop button with it and leave this agent recording with nothing on screen to say so.
    */
    expect(panelJson).toContain('modules.transcribe.enabled || modules.transcribe.available');
    expect(panelJson).not.toContain('!modules.transcribe.enabled && !modules.transcribe.available');
  });

  it('offers recording, and leaves picking a call back up to the call module', () => {
    /*
      The header's one control is now only ever about transcribing, which is what the panel is.

      A Continue button lived here and was in the wrong panel: two panels sit side by side about one
      call and only this one offered the way into it. It is `call.continueCallButton` now, placed
      against the call's own name — so this asserts the *absence*, since a copy reappearing here is
      the regression, and `packages/module-system/call/src/index.test.ts` asserts the behaviour.
    */
    expect(panelJson).toContain('modules.transcribe.toggle');
    expect(panelJson).not.toContain('modules.call.continueCall');
    // The three-action chain it replaced, still gone. Adoption happens on its own now.
    expect(panelJson).not.toContain('modules.transcribe.resume');
    expect(panelJson).not.toContain('{"$action":"routeStore.setParam","args":["call",null]}');
  });

  it('still says in words what a past call can be picked back up', () => {
    /*
      The button left; the sentence did not, and it matters more now that the offer is not directly
      above it. An empty transcript on a finished call is the one surface with room to explain the
      act, and the wording still tells join and continue apart for the reason the button's label did.
    */
    expect(linesJson).toContain('Continue the call to begin transcribing.');
    expect(linesJson).toContain('Join the call to begin transcribing.');
    expect(linesJson).toContain('modules.transcribe.callOnScreenLive');
  });
});

/**
 * Whether the call on screen is the one being recorded.
 *
 * The reported bug: continuing a call from the module rail leaves the address naming it, where the
 * panel's own continue button cleared the parameter as it went. While this asked "does the address
 * name a call", those two paths disagreed — the rail's left a meeting in progress reading as a past
 * one, with no meter, no coverage, no unsaved line and no REC badge for the rest of it.
 */
describe('which call is live', () => {
  it('asks whether the call named is the one being recorded, not whether one is named', () => {
    // `callId` rather than `collectionId`: the collection appears on the first utterance, so the
    // panel would call a joined-but-silent call a past one until somebody spoke.
    expect(VIEWING_LIVE_EXPR).toContain('modules.transcribe.callId');
    expect(VIEWING_LIVE_EXPR).toContain('!routeStore.params.call');
    // The test it used to make, which is true of a live call the address happens to name.
    expect(VIEWING_LIVE_EXPR).not.toContain('? false : true');
  });

  it('is the one question, asked once', () => {
    /*
      Five surfaces gated on it and four of them had spelled it out for themselves, so the fix had
      to land in five places or in none. They read the shared expression now.
    */
    for (const json of [panelJson, JSON.stringify(pendingUtterance), JSON.stringify(extractionActivity)]) {
      expect(json).not.toContain("!routeStore.params.call'");
    }
    expect(panelJson).toContain(VIEWING_LIVE_EXPR);
  });
});

describe('the feed', () => {
  it('keeps the unsaved line inside the scroll region, with the rows', () => {
    /*
      Outside it, the line is pinned to an edge of the panel while a short transcript sits at the
      other, and the first sentence written appears to leap the gap between them. Inside, it follows
      the last row whether there are two of them or two hundred.
    */
    expect(feedJson).toContain('"pin":"end"');
    expect(feedJson).toContain('transcribe.transcriptLines');
    expect(feedJson.indexOf('transcribe.transcriptLines')).toBeLessThan(feedJson.indexOf('Not saved yet'));
  });

  it('offers a way back to either end of a transcript somebody has scrolled through', () => {
    // `pin` lets go of a reader who scrolls up and offers nothing to undo that; in a live transcript
    // the bottom keeps moving, so scrolling back to it by hand is a chase.
    expect(feedJson).toContain('"jump":"both"');
  });

  it('times a row by the clock once the call is over, and relatively while it is not', () => {
    /*
      Every row of a transcript came out of one conversation, so relative time says the same thing on
      all of them — "6 days ago", two hundred times, carrying nothing and taking the width that made
      the row wrap. The clock says where in the meeting the line was, which is the question.

      Pinned as one node rather than two: `relative` short-circuits inside the primitive, so a branch
      here would unmount and rebuild every row the moment a call ended.
    */
    expect(linesJson).toContain(
      '"relative":{"$":"!routeStore.params.call || routeStore.params.call == modules.transcribe.callId"}',
    );
    expect(linesJson).toContain('"timeStyle":"short"');
  });

  it('mends a line at the size it is read at, in a box that starts one row tall', () => {
    /*
      `size` presets carry type as well as padding, so a compact control also shrank the words —
      mending a line made it visibly smaller than the line beside it. And two fixed rows is half a
      box of empty space under an utterance that is usually one line long.
    */
    expect(linesJson).toContain('"fontSize":"300"');
    expect(linesJson).toContain('"autoGrow":true');
    expect(linesJson).not.toContain('"rows":2');
  });

  it('leaves plain speech unmarked, and marks the two kinds of line that are not', () => {
    /*
      A transcript is speech almost all the way down. Marking it would put furniture on every row to
      restate the panel's own title, and a mark that appears everywhere is one people stop reading —
      so `spoken` is the silent default and the marks exist for where the reader's assumption would
      be wrong.
    */
    expect(linesJson).toContain("utterance.source == 'typed'");
    expect(linesJson).toContain("utterance.source == 'corrected'");
    // No sparkle: machine-heard is the assumption in a transcript, so it would not be news.
    expect(linesJson).not.toContain('sparkle');
  });

  it('names who gives up space on the meta row, so the marks are never crushed', () => {
    /*
      A flex item's automatic minimum size is its content, so an unsaid contract takes the deficit
      out of whatever can shrink. Typography defaults to `overflow-wrap: anywhere`, which drops a
      word's min-content width to one glyph — so "(edited)" could shrink to nothing and broke
      mid-word onto two lines in a narrow panel.

      The name is the only thing on the row with a sensible narrower form, and `truncate` needs
      `minWidth: 0` to happen at all.
    */
    // `0 1 auto`: shrink without growing. A grow factor would take every spare pixel and push the
    // clock, the marks and the pencil to the far edge, which is right-aligning a row nobody asked
    // to be right-aligned.
    expect(linesJson).toContain('"truncate":true,"flex":"0 1 auto","minWidth":"0"');
    expect(linesJson).toContain('"whiteSpace":"nowrap"');
    /*
      And nothing on the marks. `we-tooltip` is `display: contents`, so the badge and the text are
      themselves the flex items and their own refusal to shrink is what counts — `we-badge` already
      declares it in the primitive. A `flexShrink` out here would be the workaround from when the
      wrapper took a box, which is the thing that stopped being true.
    */
    expect(linesJson).not.toContain('"flexShrink"');
  });

  it('lets go of the pointer on the way out of the editor, so the pencil does not flash', () => {
    /*
      Leaving the editor makes the row shorter — a field and two buttons become one line — so it
      reflows out from under a pointer that was on Cancel. Without this the read view mounts with
      `pointerOnRow` still true, the pencil fades in over 200ms, and the pointer is by then outside
      the shrunken row so it fades straight back out.

      Both exits, since the row reflows the same way whichever one is taken.
    */
    // Matched on the handler each belongs to, not by counting: a bare count is also satisfied by the
    // row's own mouseleave, which writes the same token and would have let this pass with the fix
    // removed from one of the two exits.
    const both = '[{"$setLocal":"mending","value":false},{"$setLocal":"pointerOnRow","value":false}]';
    expect(linesJson).toContain(`"onClick":${both}`);
    expect(linesJson).toContain(`"onSuccess":${both}`);
  });

  it('gives the typed mark a ground, so it does not read as part of the clock', () => {
    /*
      In `en-US` the time ends "AM" or "PM", and a bare "Aa" in the same faint grey right after it is
      one word to the eye. Moving the mark to the other side of the row was tried first and did not
      help — what separates them is a *ground*, not a gap, so the mark stops being loose text on the
      row and becomes a thing sitting on it.

      The badge's own neutral fill is `control-surface` for exactly this: a step away from the row's
      `surface-sunken` in either polarity. See BADGE_APPEARANCE_DEFAULTS, where this row is the case
      that argued it.
    */
    expect(linesJson).toContain('{"type":"we-badge","props":{"size":"xs","variant":"neutral"}');
    /*
      A keyboard rather than the letterform it used to be. Everything on this row is text, so what
      the mark is about is how the line *arrived* — and the panel's own record button now spends
      `text-aa` on transcription, as the call bar always did. One surface cannot give that glyph two
      meanings a few rows apart.
    */
    expect(linesJson).toContain('keyboard');
    expect(linesJson).not.toContain('text-aa');
  });

  it('says a corrected line was edited in words, not behind a hover', () => {
    /*
      This is a claim about whether the line is still a verbatim quote. A tooltip is invisible on a
      touchscreen and to anybody not poking at rows, which is the wrong property for a trust signal —
      so the words carry it and the tooltip only adds when.
    */
    expect(linesJson).toContain('(edited)');
    expect(linesJson).toContain('"value":{"$":"utterance.updatedAt"}');
  });

  it('abbreviates the relative form, which is the one thing on the row with a shorter form', () => {
    /*
      A prop nothing sets is a prop that does nothing, and this one shipped that way once: the
      primitive gained `relativeStyle` and no call site named it, so every row went on reading
      "3 hours ago" in a panel narrow enough that the phrase was the reason the row wrapped.

      `narrow` rather than Intl's `short`, which in English does not abbreviate "days" at all — so it
      leaves the widest string untouched — and spells the rest with full stops.
    */
    expect(linesJson).toContain('"relativeStyle":"narrow"');
    expect(linesJson).not.toContain('"relativeStyle":"short"');
  });
});

describe('the recording indicator', () => {
  it('uses the danger fill rather than the foreground measured for reading', () => {
    /*
      `danger-text` is a derived foreground: its lightness is moved until it is legible against a
      card, which in a dark theme lifts it into a pale pink. Right for an error sentence somebody has
      to read; wrong for a recording indicator, which is not text and has to register as an alarm at
      a glance. The fill role holds a pinned lightness and full chroma in either polarity.
    */
    expect(panelJson).not.toContain('danger-text');
    expect(JSON.stringify(captureMeter)).not.toContain('danger-text');
  });

  it('carries all three recording states in the button, so nothing else has to', () => {
    /*
      There was a solid red REC chip beside this. Between them they made one point twice, and the
      split was forced: the button had two variants, so it could not look different while actually
      capturing and the chip was added to cover the third state. The call bar's copy has carried all
      three for a while — off quiet, armed `secondary`, capturing `danger`, on the reasoning that a
      state which arrives on its own must be legible without being looked for.
    */
    expect(panelJson).toContain(
      "modules.transcribe.listening ? 'danger' : modules.transcribe.enabled ? 'secondary' : 'ghost'",
    );
    expect(panelJson).not.toContain('"children":["REC"]');
  });

  it('says what it is in a word, and lets the button own the colour', () => {
    /*
      Icon-only, this asked a newcomer to know that a mark means transcription — and the panel had
      answered that once already with a REC chip that has since gone. The header has room, which the
      Continue button beside it proves, so the word carries the state and the tooltip carries the
      act. No `label` prop with them: the accessible name is the visible word rather than a second
      string that has to be kept containing it.

      The icon's own red is gone. Red is the button's now, so a colour here would be red on red,
      which is the second of the two bugs the call bar's note says were fixed there and left standing
      on this copy.
    */
    expect(panelJson).toContain("modules.transcribe.enabled ? 'Transcribing' : 'Transcribe'");
    expect(panelJson).toContain('{"type":"we-icon","props":{"name":"record"}}');
    expect(panelJson).not.toContain("modules.transcribe.listening ? 'danger' : ''");
    expect(panelJson).not.toContain("'Stop transcribing' : 'Start transcribing'\"},\"variant\"");
  });

  it('waits for the microphone, so the word on it never turns over in front of you', () => {
    /*
      This asked `callId` for a day, so that it appeared the instant a call was joined rather than a
      second later with the meter. The cost was a label that changed itself: recording starts only
      once there is a stream, so the button read "Transcribe" and then became "Transcribing".

      There is no third option. The state genuinely changes in that second, so a label reporting the
      state must change with it, and one reporting it early is guessing — auto-join can still be
      refused by `recordCalls`, and a device that never opens would leave "Transcribing" standing
      over nothing recorded with no diagnostic on screen. Waiting is the version with neither a
      changing word nor a false one.
    */
    expect(panelJson).toContain('modules.transcribe.enabled || modules.transcribe.available');
    expect(panelJson).not.toContain('modules.transcribe.enabled || modules.transcribe.callId');
  });
});

describe('the extraction panel', () => {
  const json = JSON.stringify(extractionPanel);

  it('asks about the call on screen, in every one of the three answers', () => {
    /*
      The gap that made the workshop's own copy wrong in two directions at once. It asked these about
      the *live* call and drew the results of the addressed one, so the chips said what one call was
      looking for above a list of what a different call had found — and the Extract button was hidden
      by a guard about the wrong record even though the action behind it takes an id.

      Keyed rather than three accessors, because an expression cannot pass an argument to a store
      member. Same shape as `recordStore.displays[row.type]`.
    */
    for (const field of ['targets', 'canExtract']) {
      expect(json).toContain(`modules.transcribe.extractionFor[${EXTRACTION_SUBJECT_EXPR}].${field}`);
    }

    // The chips are a `$part`, so the third answer is asked in the fragment rather than here.
    const chips = JSON.stringify(extractionTargets);
    expect(chips).toContain(`modules.transcribe.extractionFor[${EXTRACTION_SUBJECT_EXPR}].canChoose`);
    expect(chips).toContain(`modules.transcribe.extractionFor[${EXTRACTION_SUBJECT_EXPR}].targets`);
  });

  it('changes the list of the call it is showing, not the one this agent is in', () => {
    const chips = JSON.stringify(extractionTargets);

    expect(chips).toContain('"$action":"modules.transcribe.toggleExtractionTarget"');
    expect(chips).toContain(`{"$":"target.entity"},{"$":"${EXTRACTION_SUBJECT_EXPR}"}`);
  });

  it('falls back to the call’s own record rather than the transcript’s', () => {
    /*
      A different fallback from the transcript's, and the difference is the point. `collectionId` is
      null until somebody speaks, which is the honest answer for a transcript; extraction is asked
      earlier than that, because choosing what a meeting will look for — before the meeting — is
      exactly when somebody wants to.
    */
    expect(EXTRACTION_SUBJECT_EXPR).toContain('routeStore.params.call');
    expect(EXTRACTION_SUBJECT_EXPR).toContain('modules.transcribe.callId');
    expect(EXTRACTION_SUBJECT_EXPR).not.toContain('collectionId');
  });

  it('runs a pass over that call rather than over the one this agent is in', () => {
    expect(json).toContain('modules.transcribe.extractCollection');
    expect(json).not.toContain('"$action":"modules.transcribe.extract"');
  });

  it('keeps "as it happens" to the live call, where it is the only thing that means anything', () => {
    // A meeting somebody opened from a link is not happening. Everything else here follows the call
    // on screen; this one cannot.
    const live = '{"$":"!routeStore.params.call || routeStore.params.call == modules.transcribe.callId"}';
    expect(json.indexOf(live)).toBeLessThan(json.indexOf('Auto extract: on'));
  });

  it('says what the two header controls do, and for whom', () => {
    /*
      The auto control was a `we-switch` whose `label` is only an aria-label — an unlabelled toggle
      beside a button reading "Extract", with nothing on screen to say which did what. Both name
      themselves now, and the auto one says it is everybody's, since the record button one panel
      over looks the same and is only this agent's microphone.
    */
    expect(json).not.toContain('"we-switch"');
    expect(json).toContain('Auto extract: on');
    expect(json).toContain('Auto extract: off');
    expect(json).toContain('for everyone in it');
    expect(json).toContain('Extract now');
    // Accent, not red: red is the transcript's word for a live microphone.
    expect(json).toContain(`modules.transcribe.autoExtract ? 'primary' : 'ghost'`);
  });

  it('says the node has no model, rather than that nothing has been said', () => {
    /*
      `extractable` is `interpretation.available()` — a fact about the node, saying nothing about
      whether a call exists. The copy answered the other question ("Nothing to read yet. What a call
      produces appears here as it is found."), so somebody on a node with no model waited for a
      conversation that was never going to help.
    */
    expect(json).toContain('This node has no model configured');
    expect(json).not.toContain('Nothing to read yet');
  });

  it('shows what the passes wrote, rather than counting them and pointing elsewhere', () => {
    // It ended at "N records written. Open the graph to see them." — a count and an errand, while
    // the records were a query away from the surface already being looked at.
    expect(json).toContain('"anchorId":{"$":"' + EXTRACTION_SUBJECT_EXPR + '"}');
    expect(json).toContain('recordStore.displays[item.__subjectClass].title');
  });

  it('asks about a new record and a change to an agreed one as two different questions', () => {
    /*
      One list drew a change a pass suggested to somebody's task as a draft of the task, offered
      Keep and Discard on it, and showed only the new value. The changes are their own group now:
      the record as it is, each change as old → new, applied or dismissed per field.
    */
    expect(json).toContain(".filter(p, p.kind != 'update')");
    expect(json).toContain(".filter(p, p.kind == 'update')");
    expect(json).toContain('"children":["Pending changes"]');
    expect(json).toContain('"$action":"modules.transcribe.applyChange"');
    expect(json).toContain('"$action":"modules.transcribe.dismissChange"');
    // The old half comes from the record itself, asked for by id once the model is known.
    expect(json).toContain('"current":{"entity":{"$":"proposal.entity"},"where":{"id":{"$":"proposal.id"}}');
    // An agreed record with a change suggested still counts as extracted.
    expect(json).not.toContain('modules.transcribe.pendingIds');
  });

  it('reads what a call produced through the provenance link, in one subscription', () => {
    /*
      The question "what did this call produce" is unaskable through `children`: it holds the
      transcript too, an untyped include carries no class constraint, and a query names one entity —
      so the panel asked "all the tasks, then all the events" and got the grouping that produced.

      `CollectionBlock.extracted` is written beside containment by every pass, so the relation is the
      answer. An include over it comes back polymorphically, which is why the rows can be ordered by
      when they were made rather than by which model they happen to be, and why there is a number to
      put beside the heading at all.
    */
    expect(json).toContain('"extracted":{"order":{"createdAt":"desc"}}');
    // And the amendments in the same include, so "what did this call produce" and "what did it
    // change" are one answer rather than two that can disagree about whether it has been asked yet.
    expect(json).toContain('"amendments":{"order":{"createdAt":"desc"}}');
    expect(json).toContain(
      'first(local.extractedFrom).extracted.filter(r, !(r.id in modules.transcribe.unconfirmedIds))',
    );
    // Keyed on the class each row turned out to be. Not `item.type`, which is a real property on a
    // CollectionBlock and so means something else on some of the rows a call can hold.
    expect(json).toContain('recordStore.displays[item.__subjectClass]');
    expect(json).not.toContain('recordStore.displays[target]');
  });

  it('explains itself behind the glyph, not in the body', () => {
    /*
      The box above the chips held three lines of prose — a bold "Extract" under a panel already
      called Extraction, a lead-in above the chips, a footnote under the button — every one of them
      true, read once, and thereafter furniture in a docked panel with no room to spare. What they
      said is in the header's help now, which is read on demand.
    */
    expect(json).not.toContain('Look through what was said for');
    expect(json).not.toContain('press Extract to sweep');
    expect(json).not.toContain('"children":["Extract"]');
    expect(json).toContain('"label":"How this works"');
    expect(json).toContain('before a model was switched on');
    // The button keeps a phrase of its own: how it differs from the automatic pass is what somebody
    // hovering it is asking.
    expect(json).toContain('Reads the whole conversation so far');
  });

  it('answers a suggestion with the same pair of marks the board uses', () => {
    /*
      Two surfaces answering one decision should not look like two decisions, so these are the
      board's own circles: outlined, round, the glyph in the success or danger role, filling with
      that role's surface under the pointer. Words are not needed on them *because* they are the
      board's glyphs and the tooltips carry the words — and a green/red pair is the classic thing to
      fail on, so the mark is what carries the meaning for anyone who cannot separate them.
    */
    for (const [tone, glyph] of [
      ['success', 'check'],
      ['danger', 'x'],
    ]) {
      expect(json).toContain(`"r":"full","label":"${tone === 'success' ? 'Accept' : 'Reject'}"`);
      /*
        The status foreground at rest, the fill on hover — the canvas's rule, and its reason: at this
        size the icon *is* the button, so it must stay legible against the surface behind it, and
        `<tone>-text` is the role corrected for that. The fill takes over on hover, where `on-<tone>`
        answers for the contrast. A tint was tried here first and reads as the button acknowledging
        the pointer rather than as the answer it is about to give.
      */
      expect(json).toContain(
        `"color":"${tone}-text","hoverProps":{"bg":"${tone}","color":"on-${tone}","borderColor":"${tone}"}`,
      );
      expect(json).toContain(`{"type":"we-icon","props":{"name":"${glyph}","weight":"bold"}}`);
    }
    // The words are gone from the buttons themselves.
    expect(json).not.toContain('},"Keep"]');
    expect(json).not.toContain('},"Discard"]');
  });

  it('puts the answer beside the card’s own details rather than under them', () => {
    /*
      The detail rows sat above a full-width row of buttons, so every card spent a line on controls
      that fit beside what was already there — in a docked panel showing several at once, that is
      the difference between reading three and reading five.

      `ay: 'end'` because the details wrap to as many lines as they need and the answer belongs at
      the foot of the card however tall the left-hand side turns out to be.
    */
    expect(json).toContain('"ax":"between","ay":"end"');
    // And the details are hidden while the editor is open, since those fields are the same values.
    expect(json).toContain('modules.transcribe.editingProposal != proposal.id');
  });

  it('moves editing out of the answer pair, into the card’s corner', () => {
    /*
      Edit was a third button in the row of answers, which made a binary question look like a
      three-way choice however neutrally it was painted. It is not an answer — it is what you do
      before answering — so it sits apart, as a mark, with the words behind a tooltip.
    */
    const pencil = json.indexOf('"name":"pencil-simple"');
    const keep = json.indexOf('"label":"Accept"');

    expect(pencil).toBeLessThan(keep);
    expect(json).toContain('"content":"Edit before accepting"');
    expect(json).toContain('"content":"Stop editing"');
    expect(json).not.toContain('"Edit"]');
    expect(json).not.toContain('"Cancel"]');
  });

  it('leaves what a pass produced to the two readouts that already say it', () => {
    /*
      A tick and "N records written." stood above the chips until the next press. The results
      themselves appear under "Accepted", and `ExtractionPass` records the outcome and count of
      every pass — one-shot and standing alike — so the history holds what this held and keeps
      holding it afterwards.

      The spinner and the failure alert stay: one is the only sign a press did anything, and the
      other is the one outcome neither readout can be relied on to carry.
    */
    expect(json).not.toContain('records written.');
    expect(json).toContain('Reading the transcript…');
    expect(json).toContain("modules.transcribe.extractStatus == 'error'");
  });

  it('draws a closed vocabulary as plain text, like every other detail on the card', () => {
    /*
      A status or a priority came out as a coloured chip, on the reasoning that a value from a closed
      set is a state rather than a phrase. True, and it made two fields louder than the rest — a date
      sits as plain text on the same row, and a task's status is not more worth reading than an
      event's start. These are the details of a suggestion nobody has agreed to yet, and two chips
      gave a card two focal points besides its own headline.

      The board is where a status earns its colour: a column there *is* the status, in the
      community's own colour. Here it is one line among several.
    */
    expect(json).not.toContain("last(field.options) ? 'success'");
    // The one badge left is the count beside "Pending acceptance", which is a number and not a
    // state. Left open at the end rather than closing the props object: what is being pinned is
    // that the badge is the count's, and it should not have to be rewritten when the count's chip
    // gains a size or a colour.
    expect(json).toContain('"we-badge","props":{"size":"xs","variant":"warning","appearance":"solid"');
  });

  it('lists only the fields a record actually has something in', () => {
    /*
      Every declared relation becomes a detail field, and `WeNode` declares five — comments,
      signals, participants, calls, mentions — which every model in the space inherits. A record
      carries a to-many relation as a list, and an empty list is truthy, so a plain truthiness test
      kept all five: an extracted task listed five captions with nothing after any of them.

      `count` answers for a list and gives 0 for anything else, so it cannot stand in for the scalar
      test either. The `many` flag is what picks between them.
    */
    expect(json).toContain('f.many ? count(item[f.name]) : item[f.name]');
    // The suggestion card keeps the plain test, and should: a field the pass did not propose is
    // absent from its list rather than present and empty, so there is no list to count.
    expect(json).toContain("f.role == 'detail' && find(proposal.fields, { name: f.name }).value");
  });

  it('says what a card is in words and an edge, not in a glyph per card', () => {
    /*
      Every card was a `we-alert`, which always draws a status glyph — deliberately, since its own
      note points at WCAG 1.4.1 and a lone alert needs colour not to be the only thing carrying its
      meaning. A grid of them is the case that rule was not written for: eight identical triangles
      say one thing eight times and crowd the titles they sit beside.

      Nothing is left relying on colour alone, which is what the rule actually asks. Each section
      says in words what its cards are — "Pending acceptance", "Pending changes", "Accepted" — and every card on
      screen sits under one of those headings.
    */
    // The card's own former shape. `we-alert` still draws the two genuine alerts in this panel — a
    // failed pass and a watch that cannot run — which is what it is for.
    expect(json).not.toContain('"we-alert","props":{"variant":"warning","appearance":"accent"');
    expect(json).not.toContain('"name":"warning"');
    // The edge the alert drew, written out, in the role each list means: one still awaiting an
    // answer, one already settled.
    expect(json).toContain('"borderLeft":"3px solid warning"');
    expect(json).toContain('"borderLeft":"3px solid success"');
  });

  it('edits a moment with a calendar rather than a raw ISO string', () => {
    /*
      A date is stored as an ISO string, so the text box rendered it raw and asked somebody to edit
      `2026-09-14T15:30` by hand — every keystroke a chance to write something the parser refuses.
      The same control the host's own record form uses for this kind.
    */
    expect(json).toContain('"type":"we-date-picker"');
    // `showTime` follows the kind: an all-day event has no time to pick, and offering one invites a
    // precision the record cannot carry.
    expect(json).toContain('"showTime":{"$":"field.kind == \'datetime\'"}');
  });

  it('draws a suggestion’s headline a size above its own metadata', () => {
    // Everything on the card was `footnote`, so bold was the only thing marking the headline — and
    // bold at the size of the metadata under it reads as emphasis in a paragraph, not a title.
    expect(json).toContain('{"variant":"label","fontWeight":"600"}');
  });

  it('gives the actual reason Extract now cannot be pressed', () => {
    /*
      `canExtract` folds three reasons into one boolean — no models in the space, nothing ticked on
      this call, nothing said yet — so a tooltip reading it alone can only guess, and it guessed the
      last one. Somebody who had just unticked the final chip was told the call was silent, which is
      wrong and unfixable by anything they would then try.
    */
    const targets = `modules.transcribe.extractionFor[${EXTRACTION_SUBJECT_EXPR}].targets`;
    const order = ['No models are set up here', 'Nothing is selected to extract', 'Nothing has been said yet'];

    expect(json).toContain(`!${targets}.exists(t, t.selected) ? 'Nothing is selected to extract'`);
    expect(json).toContain("!count(local.spoken) ? 'Nothing has been said yet'");
    // Tested in the order they rule each other out: a space with no models has nothing to tick, and
    // a call with nothing ticked cannot be fixed by waiting for somebody to speak.
    for (let i = 1; i < order.length; i += 1) {
      expect(json.indexOf(order[i - 1])).toBeLessThan(json.indexOf(order[i]));
    }
  });

  it('asks the record whether anybody has spoken, rather than trusting adoption', () => {
    /*
      `canExtract` reads `hasTranscript`, which infers words from *adoption* — and that inference
      stopped being true the moment continuing a call adopted its record straight away. Continue a
      conversation nobody spoke in and Extract went live over nothing.

      The store cannot do better alone: peers write into the shared record without telling it, so
      "is there anything in here" is a question for the graph. One row answers it.
    */
    expect(json).toContain('"spoken":{"entity":"TextBlock"');
    // Scoped to the call on screen, through the relation its utterances hang off.
    expect(json).toContain(`"via":"children","anchorId":{"$":"${EXTRACTION_SUBJECT_EXPR}"}`);
    expect(json).toContain('!count(local.spoken) || !');
    // `when`, for the reason every scoped query here carries it: an unresolved anchor is pruned
    // rather than sent, and pruning widens to every TextBlock in the space.
    expect(json).toContain(`"limit":1,"when":{"$":"${EXTRACTION_SUBJECT_EXPR}"}`);
  });

  it('offers a way to lengthen the list of things it can extract', () => {
    /*
      What a call can extract is whatever this space has models for, and the panel could only ever
      say so: the chips were a closed list with no visible route to a longer one, and the only
      mention of where that list comes from was a link that appeared solely where the chips could
      not be pressed. So "why is the thing I want not here" was two screens away with nothing
      pointing at it.

      It opens the space's vocabulary rather than doing anything itself — adding a model is a
      decision about the community, with its own screen, and a panel about one call is the wrong
      place to make it.
    */
    const chips = JSON.stringify(extractionTargets);

    expect(chips).toContain('{"$action":"shellStore.openSpaceSettings","args":["vocabulary"]}');
    expect(chips).toContain('"name":"plus"');
    // Inside the wrapping row with the chips, so it reflows with them and follows the last one.
    expect(chips.indexOf('"name":"plus"')).toBeGreaterThan(chips.indexOf('target.label'));
  });

  it('keeps Extract now at one weight, whatever the automatic pass is doing', () => {
    /*
      It dropped to `ghost` while automatic extraction was on, on the reasoning that a press is then
      the backfill rather than the usual way a pass starts. But this is the only control in the panel
      that does anything on a press, and a button that fades because a setting elsewhere is on reads
      as unavailable rather than as unnecessary.
    */
    expect(json).not.toContain("modules.transcribe.autoExtract ? 'ghost' : 'secondary'");
    // The auto button still carries its own state in its variant — that one is a toggle.
    expect(json).toContain("modules.transcribe.autoExtract ? 'primary' : 'ghost'");
  });

  it('names the chips, then puts the press that acts on them underneath', () => {
    /*
      The two controls spent a while as the top row of the sunken box holding the chips, and a
      filled button on the same ground as a row of outlined ones reads as one set of toggles —
      the confusion that had Extract looking like a fourth chip when it lived in the row itself.

      Then they were a row above the box, together. That pairing was the next thing to go: they look
      alike and answer different questions. Extract now is the one that acts on the list, so it sits
      at the end of it; the standing decision went to the header.
    */
    const label = json.indexOf('"Things to extract"');
    const chips = json.indexOf('transcribe.extractionTargets');
    // The action, not the words: "Extract now" also appears in the panel's help text, which is in
    // the header and so earlier in the string whatever the layout does.
    const press = json.indexOf('modules.transcribe.extractCollection');

    expect(label).toBeLessThan(chips);
    expect(chips).toBeLessThan(press);
  });

  it('puts the standing decision in its header, where the transcript keeps its own', () => {
    /*
      Transcribe and Continue sit at the top right of the panel one over, and both are modes — a
      state a press changes and which then persists. "Auto extract" is that shape; "Extract now" is
      an action, and it lives with the list it acts on.

      Asserted against the header row rather than by string order, since "before the body" is also
      true of anything that merely happens to be written first.
    */
    const header = JSON.stringify((extractionPanel.children as SchemaNode[])[0]);
    expect(header).toContain('modules.transcribe.toggleAutoExtract');
    // Again the action rather than the label, since the header also carries the help text and that
    // names both buttons by name.
    expect(header).not.toContain('modules.transcribe.extractCollection');
  });

  it('needs no paging control, because it no longer asks an unbounded question', () => {
    /*
      There was a "More" per model, and it never worked: it sat beside the node declaring `shown` and
      `found` rather than inside it, so both names it read were one node out of scope and the button
      never rendered once.

      It is gone rather than fixed in place. It existed to bound a query that could not say what it
      wanted — through `children` an unbounded read means the whole transcript — and the provenance
      link asks for exactly the records a pass wrote, which is small by construction.
    */
    expect(findNode(extractionPanel, (n) => declares(n.$localState, 'shown'))).toBeUndefined();
    expect(json).not.toContain('local.found');
  });

  it('declares the spoken query where the button reading it sits', () => {
    /*
      Extract now is disabled until somebody has spoken, and a `$queries` entry is only readable
      inside the node declaring it — so the two have to stay together. They came apart once, when
      the button was in the header and the query had to be hoisted to the panel root to reach it;
      both are back in the well now, which is also the node already gated on this node having a
      model at all.
    */
    const owner = findNode(extractionPanel, (n) => declares(n.$queries, 'spoken'));
    expect(owner).toBeDefined();
    expect(JSON.stringify(owner)).toContain('!count(local.spoken)');
  });

  it('gives every named region in the panel the same heading treatment', () => {
    /*
      The chips' label was a sentence-case footnote, on the reasoning that a control row is not a
      section the way a scroll area of proposals is. That drew the line in the wrong place: what
      `sectionLabel` marks is a region with a *name*, and two labelled regions in one panel wearing
      two treatments is the drift that fragment exists to stop.

      No colon on either. The caps and the tracking already say these are names rather than lead-ins.
    */
    const heading = (label: string) =>
      JSON.stringify({ ...SECTION_LABEL_PROPS, flex: '1' }) + `,"children":["${label}"]`;

    for (const label of ['Things to extract', 'Logs', 'Pending acceptance', 'Pending changes', 'Accepted']) {
      expect(json).toContain(heading(label));
    }
    expect(json).not.toContain('Things to extract:');
  });

  it('hides a section rather than heading an empty one', () => {
    /*
      Both readouts spend most of a call's life empty — nobody has read it yet — so a heading with
      nothing under it was the *usual* state rather than the exceptional one, twice over.

      The readings are gated on their own count, and the query answering it is declared a level up:
      a section that unmounts itself cannot own the query that decides whether it should, or it
      would stop asking and never come back.

      The results could not be gated the same way. Each kind is its own subscription and a schema
      cannot sum a list of queries whose length it does not know, so nothing above the groups can
      ask whether any of them found anything — which is why the heading moved into the group, where
      the question is answerable about one kind at a time.
    */
    const historyGate = json.indexOf('"condition":{"$":"count(local.passes)"}');
    expect(historyGate).toBeGreaterThan(-1);
    expect(json.indexOf('"Logs"')).toBeGreaterThan(historyGate);

    /*
      The results used to be the case that could not. One subscription per kind meant nothing above
      the groups could ask whether any of them had found anything, so the section fell back to gating
      on whether the call had any models ticked and showed a heading over an empty grid whenever it
      had targets and no results.

      Reading through the provenance link gives one list and therefore one count, so it hides itself
      on exactly the right question.
    */
    expect(json).toContain(
      '"condition":{"$":"count(first(local.extractedFrom).extracted.filter(r, !(r.id in modules.transcribe.unconfirmedIds)))"}',
    );
  });

  it('shows nothing to press outside a call, rather than a well of disabled controls', () => {
    /*
      It was an auto switch that could not be pressed, an Extract that could not run, and a chip row
      showing the space's default list greyed out — each correctly disabled and none of them
      actionable, which is a panel explaining what it *would* offer rather than what it does.

      The same gate everything else here already carries: proposals, the history and the results
      below all ask for a call first.
    */
    /*
      Anchored on the chips themselves, not on the box they used to sit in. That box is gone — a row
      of pills is already a group, and its padding was coming out of the width they wrap in — and a
      test that navigates by a background colour is a test that fails when somebody changes a
      background colour, which says nothing about whether the section is gated.
    */
    const chips = json.indexOf('"id":"transcribe.extractionTargets"');
    expect(chips, 'the chips are not drawn at all').toBeGreaterThan(-1);
    expect(
      json.lastIndexOf(`"condition":{"$":"${EXTRACTION_SUBJECT_EXPR}"}`, chips),
      'the chips are not behind the same "are we in a call" gate as everything else here',
    ).toBeGreaterThan(-1);
  });

  it('uses the same placeholder as the transcript panel, in the same words', () => {
    /*
      Both were hand-written columns with `footnote` text, a step smaller than the shared fragment
      draws — two panels side by side in one dock saying the same kind of thing in two sizes. The
      fragment also brings the delayed fade, which stops a placeholder asserting emptiness on the
      frame before a query answers.
    */
    expect(json).toContain('Join a call to start extracting things.');
    expect(json).not.toContain('Start a call.');
    // `emptyState`'s own shape: the larger padding, no `variant` on the sentence, and the delay.
    expect(json).toContain('"p":"600"');
    expect(json).toContain('"delay":400');
  });

  it('scrolls as one thing, under a header that stays', () => {
    /*
      `panelShell` clips, so something has to scroll or an open history plus a 240px code pane is cut
      off by the dock box. It used to be the two lists, each with its own scroller and each
      `flex: '1'` — so they competed for the panel's height, the chips and the log between them were
      pinned, and reading a long list meant a small window moving inside a small window.

      One scroller over the whole body instead, above the chips rather than below them. The header
      stays put because it is `panelShell`'s and sits outside this.
    */
    const scroller = json.indexOf('"we-scroll-area"');

    expect(scroller).toBeGreaterThan(-1);
    expect(json.indexOf('"we-scroll-area"', scroller + 1)).toBe(-1);
    expect(scroller).toBeLessThan(json.indexOf('transcribe.extractionTargets'));
  });

  it('folds either list away, and remembers which', () => {
    /*
      The cost of one scroller: a long list of suggestions pushes the readings and the results below
      the fold, and scrolling past all of them every time is worse than the two windows were. So each
      heading carries the count and a caret, and the count is what says whether folding is worth it.

      `persist` rather than `syncParam`: how somebody likes this panel arranged is a preference, and
      a shared link must not impose it on whoever opens it.
    */
    expect(json).toContain('"persist":"transcribe.proposalsOpen"');
    expect(json).toContain('"persist":"transcribe.extractedOpen"');
    expect(json).toContain('"$toggleLocal":"proposalsOpen"');
    expect(json).toContain('"$toggleLocal":"extractedOpen"');
  });

  it('leaves the panel’s own openness to the host', () => {
    // The dock's `edge` returns null while closed and the host gates on the space, so the
    // `$if datasetStore.currentDataset && extractionOpen` this carried was a second copy of both.
    expect(json).not.toContain('modules.transcribe.extractionOpen');
    expect(json).not.toContain('datasetStore.currentDataset');
  });
});

/**
 * The expressions the panel is built from, actually evaluated.
 *
 * Every other assertion in this file reads the serialised schema — does the token appear — and that
 * is the right test for an arrangement. It is the wrong test for a *shape*: `extractionFor` was a
 * `Proxy` first, every string assertion passed, and the panel rendered "No models are set up for AI
 * extraction here" against a space that had several. The expression resolved to `undefined`, and a
 * missing path is undefined by design, so nothing anywhere said a word.
 *
 * So the store's shape is checked through the evaluator that has to read it, against the expression
 * the panel actually carries.
 */
describe('the panel’s reads reach the store', () => {
  const CALL = 'we://a-call-from-last-month';

  /** The extraction half of a transcribe store, in the shape the module publishes it. */
  const storeBag = (targets: string[]) => ({
    modules: namespace((id) =>
      id === 'transcribe'
        ? namespace((member) =>
            member === 'callId'
              ? markReactive(() => 'we://the-live-call')
              : member === 'extractionFor'
                ? markReactive(() =>
                    namespace((collection: string) => ({
                      targets: targets.map((entity) => ({ entity, label: entity, selected: true })),
                      canChoose: true,
                      canExtract: collection === CALL,
                    })),
                  )
                : undefined,
          )
        : undefined,
    ),
    routeStore: namespace((member) => (member === 'params' ? markReactive(() => ({ call: CALL })) : undefined)),
  });

  // `markReactive` is the host's own — the tag is a unique symbol, so a hand-rolled stand-in with
  // `Symbol.for` matches nothing and every read below would come back undefined, which is the exact
  // failure this file exists to catch.

  const run = (source: string, roots: Record<string, unknown>) =>
    evaluateExpression(parseCached(source), {
      root: (name) => (name in roots ? { bound: true, value: roots[name] } : { bound: false, value: undefined }),
      call: (name, args) => (name === 'count' ? (Array.isArray(args[0]) ? args[0].length : 0) : undefined),
    });

  it('resolves the subject to the call in the address', () => {
    expect(run(EXTRACTION_SUBJECT_EXPR, storeBag(['TaskBlock']))).toBe(CALL);
  });

  it('finds that call’s targets, which is what the chips count', () => {
    const roots = storeBag(['TaskBlock', 'EventBlock']);
    const targets = `modules.transcribe.extractionFor[${EXTRACTION_SUBJECT_EXPR}].targets`;

    expect(run(`count(${targets})`, roots)).toBe(2);
    expect(run(`${targets}.map(t, t.entity)`, roots)).toEqual(['TaskBlock', 'EventBlock']);
  });

  it('finds that call’s answer, not the live call’s', () => {
    const roots = storeBag(['TaskBlock']);
    const forSubject = `modules.transcribe.extractionFor[${EXTRACTION_SUBJECT_EXPR}].canExtract`;
    const forLive = 'modules.transcribe.extractionFor[modules.transcribe.callId].canExtract';

    expect(run(forSubject, roots)).toBe(true);
    expect(run(forLive, roots)).toBe(false);
  });

  /**
   * The empty transcript's sentence, evaluated rather than matched.
   *
   * Six branches deciding one line, and their *order* is what makes them exclusive — a string
   * search can see every sentence is present and say nothing about which one a reader would get.
   * These are the six situations, written as the store would answer them.
   */
  describe('what an empty transcript says', () => {
    /**
     * The two sentences, dug out of the tree rather than restated.
     *
     * Two because they are two branches of a `$if` on whether the call on screen is the one being
     * recorded — which is what makes continuing a call fade one out and the other in, rather than
     * swapping the text in place. `messageFor` below does what the renderer does: answers that
     * condition against the situation, then reads the branch it selects.
     */
    const messages = (() => {
      const found: string[] = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== 'object') return;
        const fields = node as Record<string, unknown>;
        const first = Array.isArray(fields.children) ? (fields.children[0] as { $?: string } | undefined) : undefined;
        // Both branches carry this sentence, and nothing else in the tree does — which is what
        // makes it the marker rather than a word like "transcribe" that the rows use too.
        if (fields.type === 'we-text' && first?.$?.includes('Nothing has been said here yet')) found.push(first.$);
        Object.values(fields).forEach(walk);
      };
      walk(transcriptLines);
      // Deduped: the placeholder is referenced from both arms of the gate above it — one waits for
      // the query to answer, the other has no record to wait for — so every sentence is found twice.
      return [...new Set(found)];
    })();

    /** A transcribe store and a call store, answering the six things this sentence asks them. */
    const situation = (over: {
      address?: string;
      recording?: string;
      enabled?: boolean;
      /** Whether this agent's microphone is up. False through the second after joining a call. */
      micUp?: boolean;
      inACall?: boolean;
      liveRecords?: string[];
      callModule?: boolean;
    }) => ({
      modules: namespace((id) =>
        id === 'transcribe'
          ? namespace((member) =>
              member === 'callId'
                ? markReactive(() => over.recording ?? '')
                : member === 'enabled'
                  ? markReactive(() => over.enabled === true)
                  : member === 'available'
                    ? markReactive(() => over.micUp === true)
                    : member === 'inCall'
                      ? markReactive(() => over.inACall === true)
                      : member === 'callOnScreenLive'
                        ? markReactive(() => (over.liveRecords ?? []).includes(over.address ?? ''))
                        : undefined,
            )
          : // The call module's *presence* is all the panel asks about it now; its members are not read.
            // A plain object, as the real bag holds one: a bare namespace reads as undefined.
            id === 'call' && over.callModule !== false
            ? {}
            : undefined,
      ),
      routeStore: namespace((member) =>
        member === 'params' ? markReactive(() => ({ call: over.address ?? '' })) : undefined,
      ),
    });

    /** What a reader would see: the branch the live test selects, evaluated in that situation. */
    const messageFor = (roots: Record<string, unknown>) => {
      const live = run(VIEWING_LIVE_EXPR, roots);
      const [forLive, forPast] = messages;

      expect(messages).toHaveLength(2);
      return run(live ? forLive : forPast, roots);
    };

    it('offers the way in where there is no call at all', () => {
      // Joining is the only step named, because it is usually the only one: `recordCalls` defaults
      // on, so transcription starts with the call. "Press record" belongs to the one state it is
      // true in, which is the next case down.
      expect(messageFor(situation({}))).toBe('Join a call to transcribe what is said.');
    });

    it('offers the record button where this agent is in a call and not using it', () => {
      expect(messageFor(situation({ recording: 'rec-live', micUp: true }))).toBe(
        'Nothing has been said here yet. Press Transcribe to write down what is said.',
      );
    });

    it('says nothing about pressing record while the microphone is still coming up', () => {
      /*
        The second between joining a call and the audio graph opening. Recording starts on its own
        there, so the advice is wrong — and it was on screen just long enough to change the sentence
        twice on the way to the one it keeps. Landing on that sentence early is what makes the join
        one transition instead of three.
      */
      expect(messageFor(situation({ address: 'rec-old', recording: 'rec-old' }))).toBe(
        'Nothing has been said here yet.',
      );
    });

    it('says only that it is waiting once recording is on', () => {
      expect(messageFor(situation({ recording: 'rec-live', micUp: true, enabled: true }))).toBe(
        'Nothing has been said here yet.',
      );
    });

    it('offers to pick up a call nobody is in', () => {
      expect(messageFor(situation({ address: 'rec-old' }))).toBe(
        'Nothing has been said here yet. Continue the call to begin transcribing.',
      );
    });

    it('offers to join one somebody is in, which is a different act with the same press', () => {
      expect(messageFor(situation({ address: 'rec-old', liveRecords: ['rec-old'] }))).toBe(
        'Nothing has been said here yet. Join the call to begin transcribing.',
      );
    });

    it('promises nothing while another call is running, because nothing would honour it', () => {
      // Continuing then would re-point every peer's transcript at the old record, so the panel's
      // button is gone and the rail refuses too. A clause nothing will act on is worse than none.
      expect(messageFor(situation({ address: 'rec-old', recording: 'rec-other', inACall: true }))).toBe(
        'Nothing has been said here yet.',
      );
    });

    it('does not offer to join a call while it is fading out of one', () => {
      /*
        A branch being faded out is still live. Leaving a continued call empties `callId` while the
        address still names the record, so the live branch re-rendered on its way out and offered to
        join a call — the opposite of what the incoming branch was about to say — for the length of
        the exit.

        Evaluated against the live branch directly rather than through `messageFor`, because the
        situation is one where that branch has already lost: this is what it says while it leaves.
      */
      const [forLive] = messages;

      expect(run(forLive, situation({ address: 'rec-old' }))).toBe('Nothing has been said here yet.');
      // And the sentence is still reachable where it is true: no address, and nothing recording.
      expect(run(forLive, situation({}))).toBe('Join a call to transcribe what is said.');
    });

    it('promises nothing in a deployment with no call module', () => {
      // `modules.call` resolves to nothing rather than failing, which is the whole reason this
      // module may name another one at all.
      expect(messageFor(situation({ address: 'rec-old', callModule: false }))).toBe('Nothing has been said here yet.');
    });
  });
});

/** Whether a node's `$localState` or `$queries` bag declares a name. */
function declares(bag: unknown, name: string): boolean {
  return typeof bag === 'object' && bag !== null && name in bag;
}

/**
 * The first node anywhere in a tree that answers a question about itself.
 *
 * Walks every nested object rather than only `children`, because a panel reaches most of its rows
 * through `$if` branches, which live in `props.then`. Used by the tests about *where* a declaration
 * sits — a whole class of bug in a schema is a name read one node above the state that declares it,
 * which is silent at runtime and invisible to a string search, since every string involved is
 * already correct.
 */
function findNode(
  value: unknown,
  matches: (node: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const node = value as Record<string, unknown>;
  if (matches(node)) return node;
  for (const nested of Object.values(node)) {
    const found = findNode(nested, matches);
    if (found) return found;
  }
  return undefined;
}

describe('the history of what was read', () => {
  const json = JSON.stringify(extractionPanel);

  it('reads passes written down against the call on screen', () => {
    /*
      `interpretationStore` is a live subscription: it starts empty, fills as passes run, and is
      thrown away on every space change. So a call read an hour ago looked exactly like one never
      read at all, and a failed pass looked exactly like one that found nothing — which are the two
      things somebody reviewing a meeting most needs told apart.
    */
    expect(json).toContain('"entity":"ExtractionPass"');
    expect(json).toContain('"via":"extractionPasses"');
    expect(json).toContain(`"anchorId":{"$":"${EXTRACTION_SUBJECT_EXPR}"}`);
  });

  it('draws the outcome rather than a tick on everything', () => {
    // The template's own version drew a green check on every settled row because it never read the
    // outcome, so a pass that failed and one that wrote nine records looked identical.
    expect(json).toContain("pass.outcome == 'failed'");
    expect(json).toContain("pass.outcome == 'skipped'");
    expect(json).toContain('pass.error');
  });

  it('says what a pass found in the words the chips use', () => {
    /*
      "Things", not "records" — a record is what the graph stores, and the list above these rows is
      already headed "Things to extract". "No records" also read as a failure to write rather than
      as a pass that looked and found nothing, which is an ordinary outcome and the one this line
      reports most often.
    */
    expect(json).toContain("plural(pass.recordCount, 'thing', 'things')} found");
    expect(json).toContain("'Nothing found'");
    expect(json).not.toContain("plural(pass.recordCount, 'record', 'records')");
  });

  it('indents the stored exchange, which a query cannot do on its own', () => {
    /*
      The record holds the prompt and the response verbatim, which is right for a record and
      unreadable as a pane: both are one unbroken line, so the editor came out a one-line trough
      with a horizontal scrollbar. The live feed indents in its store; a query has no store in the
      way, so the host lends the function the expression library deliberately lacks.
    */
    expect(json).toContain('formatJson({ text: pass.prompt })');
    expect(json).toContain('formatJson({ text: pass.response })');
  });

  it('says which passes somebody fired by hand', () => {
    /*
      A one-shot pass and a watched one are the same act with the same result, which is why they are
      one list now rather than a durable log beside an ephemeral bar. The only difference worth
      seeing is why it happened, so the row carries a glyph for it — and nothing at all when the
      record predates the field, since an absent property is absent rather than defaulted and
      guessing would put a claim on screen that was never stored.
    */
    expect(json).toContain('"condition":{"$":"pass.trigger"}');
    expect(json).toContain("pass.trigger == 'auto' ? 'lightning' : 'cursor-click'");
  });

  it('opens a stored pass onto the exchange, the way the live bar does', () => {
    // The point of storing the prompt and response is that they outlive the bar. Same two panes,
    // same defaults — prompt closed, response open — so a pass read while it ran and the same pass
    // read a week later are the same thing.
    expect(json).toContain('"code":{"$":"pass.prompt"}');
    expect(json).toContain('"code":{"$":"pass.response"}');
    expect(json).toContain('"$toggleLocalIn":"openHistoryPasses"');
    expect(json).toContain('!(pass.id in local.closedHistoryResponses)');
  });

  it('offers the disclosure only where there is an exchange under it', () => {
    // A record written before the fields existed carries neither half, and a press answered with an
    // empty box is worse than a row that never looked pressable.
    expect(json).toContain('"condition":{"$":"pass.prompt || pass.response"}');
  });

  it('keeps the live feed to the live call, and to passes still running', () => {
    /*
      Two narrowings, and the second is newer. The store's rows carry no call id, so on a past call
      they described the wrong conversation — hence the live-call test.

      And `runningCount` rather than `hasActivity`, which counts settled rows too. That was right
      while this was the only place a finished pass was reported; once every pass became an
      `ExtractionPass` listed under "Logs" in the same panel, the settled half of this feed was the
      same rows again a few hundred pixels higher with no heading to tell them apart.
    */
    expect(JSON.stringify(extractionActivity)).toContain(
      'interpretationStore.runningCount && (!routeStore.params.call || routeStore.params.call == modules.transcribe.callId)',
    );
  });

  it('wraps the running label between words and never squeezes the clock', () => {
    /*
      The label was `truncate` with `flex: '1'` and no `minWidth`, so it refused to be narrower than
      its whole line: it ran off the panel, and the row took the room out of the elapsed clock
      instead, folding "1:23" onto two lines.
    */
    const activity = JSON.stringify(extractionActivity);
    expect(activity).toContain('{"type":"we-text","props":{"fontSize":"200","flex":"1","minWidth":"0"}');
    expect(activity).toContain('"flexShrink":"0","whiteSpace":"nowrap"');
  });

  it('leaves finished passes to the durable log, and lists them once', () => {
    /*
      The bug this replaced: the readings appeared twice on a call, once above the "Logs" heading
      from the live feed's collapsed settled list and once below it from the stored records.

      Caused by unifying the two kinds of pass. Before that the feed carried the watched ones and
      the log carried the pressed ones, so between them they showed each pass once; making both
      complete made them duplicates.
    */
    const activity = JSON.stringify(extractionActivity);
    expect(activity).not.toContain('interpretationStore.settledPasses');
    expect(activity).not.toContain('extractions processed');
    // The log keeps its own count, which is the one that survives a reload. On the heading's badge
    // now, where the other two sections carry theirs — it used to be spelled out a row lower, in a
    // line that also owned the fold.
    expect(json).toContain('"count(local.passes)"');
  });

  it('folds the readings from their heading, like every other section', () => {
    /*
      The fold was a row *under* the "Logs" heading carrying its own caret and its own count, so
      this was the one section of three whose heading did nothing and the one list that folded from
      somewhere else. Two rows of chrome over one list, saying the count twice.

      Asserted as the absence of the row as well as the presence of the heading control: leaving
      both would not fail anything, and would be exactly the state this is about.
    */
    expect(json).toContain('"$toggleLocal":"logsOpen"');
    expect(json).toContain('"persist":"transcribe.logsOpen"');
    expect(json).not.toContain('historyOpen');
    expect(json).not.toContain('of this call`');
  });

  it('makes the whole heading row the control, not just its caret', () => {
    /*
      The fold was a glyph-sized button at the far end of a row whose obvious target is the word
      naming the thing. Asserted structurally rather than by string, because "the heading is the
      button" is a statement about which node the handler sits on — a search of the serialised panel
      would pass just as happily with the caret button back and the row inert around it.

      Exactly one `we-button` inside each toggle: the caret cannot go back to being its own, because a
      button nested in a button is invalid markup and would take the press on the way past and
      toggle twice. A heading carrying an action — Logs' export — is split into two toggles around
      it, the name and the count, so a field may have two; the name is always one of them.
    */
    const fields = ['proposalsOpen', 'changesListOpen', 'extractedOpen', 'logsOpen'];
    const found: Record<string, string[]> = {};

    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) return void node.forEach(walk);
      const n = node as { type?: string; props?: Record<string, unknown> };
      const field = (n.props?.onClick as { $toggleLocal?: string } | undefined)?.$toggleLocal;
      if (field && fields.includes(field)) {
        expect(n.type, `${field} is toggled from a ${n.type}`).toBe('we-button');
        (found[field] ??= []).push(JSON.stringify(node));
      }
      Object.values(n).forEach(walk);
    };
    walk(extractionPanel);

    expect(Object.keys(found).sort()).toEqual([...fields].sort());

    for (const [field, label] of [
      ['proposalsOpen', 'Pending acceptance'],
      ['changesListOpen', 'Pending changes'],
      ['extractedOpen', 'Accepted'],
      ['logsOpen', 'Logs'],
    ]) {
      expect(found[field].some((toggle) => toggle.includes(`"${label}"`))).toBe(true);
      for (const toggle of found[field]) expect(toggle.match(/"type":"we-button"/g)).toHaveLength(1);
    }
  });

  it('puts the readings above the queue, and the queue above what it produced', () => {
    /*
      The panel reads as what it does, in order: what will be looked for, what is running, every
      pass so far, then the records waiting on a person and the ones already theirs.

      Before this the first thing the panel said was "answer this", with the controls that caused
      the suggestions and the log that explains them underneath. By index rather than by walking the
      tree, because what is being asserted is the order of four siblings in one array and every one
      of them is identified by a string that appears exactly once.
    */
    const chips = json.indexOf('"Things to extract"');
    const logs = json.indexOf('"Logs"');
    const awaiting = json.indexOf('"Pending acceptance"');
    const changes = json.indexOf('"Pending changes"');
    const extracted = json.indexOf('"Accepted"');

    expect(chips).toBeGreaterThan(-1);
    expect(logs).toBeGreaterThan(chips);
    expect(awaiting).toBeGreaterThan(logs);
    expect(changes).toBeGreaterThan(awaiting);
    expect(extracted).toBeGreaterThan(changes);
  });
});

describe('the things to extract fold like every other section', () => {
  /*
    It was the one section in this panel with a heading that did not fold and no count — which is
    also the section a reader most often wants out of the way, since it is settings rather than
    findings.
  */
  it('folds, and counts what is ticked rather than what exists', () => {
    const json = JSON.stringify(extractionPanel);
    expect(json).toContain('"$toggleLocal":"targetsOpen"');
    expect(json, 'the count is of every model, not the ticked ones').toContain('.filter(t, t.selected))');
    expect(json).toContain('"persist":"transcribe.targetsOpen"');
  });

  it('gives running a pass the same weight as keeping them running', () => {
    // `secondary` read as the lesser of the two beside an "Auto extract: on" switch, when it is the
    // one that does something this instant.
    expect(JSON.stringify(extractionPanel)).toContain('"variant":"primary"');
  });
});

describe('the extraction chips say what they are', () => {
  /*
    They read as a row of small buttons: the same radius as every other control in the panel, with
    the state carried by weight alone. Weight is a comparison — it means something once the row
    holds both kinds, and a space with one model, or with all of them ticked, gives it nothing to be
    read against.
  */
  it('are pills, and tick the ones that are on', () => {
    const chips = JSON.stringify(extractionTargets);
    expect(chips).toContain('"r":"pill"');
    const tick = chips.indexOf('"name":"check"');
    expect(tick, 'a selected chip says nothing about itself').toBeGreaterThan(-1);
    expect(
      chips.lastIndexOf('"condition":{"$":"target.selected"}', tick),
      'the tick is drawn whether or not the chip is on',
    ).toBeGreaterThan(-1);
  });

  it('sit in no well', () => {
    // A row of pills is already a group; the box drew a second boundary round it and took the room
    // the chips wrap in. It is also where a colour with no role to name it was being reached for.
    expect(JSON.stringify(extractionPanel)).not.toContain('surface-sunken');
  });
});

/**
 * Sending a typed line, and not sending it twice.
 *
 * A write is a round trip — about a second against a local node and longer against a shared remote
 * one — and the composer said nothing at all while it ran: the box was cleared on success only, so
 * the words were still there, and the button stayed enabled because its only guard was emptiness.
 * The obvious reading is that the press did not register, so the next thing somebody does is press
 * again, and the transcript gets the line twice. Nothing in this panel deletes a line, so the
 * duplicate is permanent.
 *
 * These pin the three parts of the answer that are each individually easy to drop: that both ways
 * of sending raise the flag, that the flag comes down however the write ends, and that the button
 * admits a write is happening rather than merely refusing the click.
 */
describe('the composer', () => {
  const button = findNode(transcriptComposer, (n) => n.type === 'we-button') as
    { props: Record<string, unknown> } | undefined;
  const textarea = findNode(transcriptComposer, (n) => n.type === 'we-textarea') as
    { props: Record<string, unknown> } | undefined;

  it('declares the in-flight flag beside the draft, and keeps it out of the URL', () => {
    /*
      A plain field on purpose. `syncParam` would put "a write is happening" in a link, and `persist`
      would restore, on the next launch, a composer that believes it is still writing — with no
      write to finish and so nothing to ever bring it back down.
    */
    const holder = findNode(transcriptComposer, (n) => Boolean((n.$localState as Record<string, unknown>)?.sending));
    const declared = (holder?.$localState as Record<string, Record<string, unknown>> | undefined)?.sending;
    expect(declared).toEqual({ type: 'boolean', initial: false });
    expect((holder?.$localState as Record<string, unknown>)?.message).toBeDefined();
  });

  it('runs the very same handler from the button and from Enter, so the guard cannot cover one only', () => {
    // Identity, not equality: two copies that happen to match today are two copies, and the next
    // edit changes one of them. This is what stops the flag being raised on one path and not the other.
    const enter = textarea?.props['on:submit'] as { $if?: { then?: unknown } } | undefined;
    expect(enter?.$if?.then).toBe(button?.props.onClick);
  });

  it('refuses a second send while one is going, on both paths', () => {
    expect(button?.props.disabled).toEqual({ $: '!trim(local.message) || local.sending' });
    /*
      The field is guarded by a condition rather than by `disabled`, and that asymmetry is
      deliberate: disabling what somebody is typing into takes the focus away mid-sentence, which is
      a worse interruption than the bug. So the condition has to restate both halves of what
      `disabled` says on the button — there are words, and nothing is already in flight.
    */
    const enter = textarea?.props['on:submit'] as { $if?: { condition?: unknown } } | undefined;
    expect(enter?.$if?.condition).toEqual({ $: 'trim(local.message) && !local.sending' });
  });

  it('says a write is happening rather than only refusing the click', () => {
    // The half that answers the actual report. `disabled` alone stops the duplicate and still leaves
    // a composer that looks broken for a second, which is what produced the second press.
    expect(button?.props.loading).toEqual({ $: 'local.sending' });
  });

  it('lowers the flag however the write ends, and keeps the words unless it succeeded', () => {
    const send = button?.props.onClick as Record<string, unknown>[];
    const write = send.find((step) => '$action' in step) as Record<string, unknown>;
    // `onFinally`, not `onSuccess`: a box that could never be sent again because one write failed
    // would be a worse bug than the one this fixes.
    expect(write.onFinally).toEqual([{ $setLocal: 'sending', value: false }]);
    expect(write.onSuccess).toEqual([{ $setLocal: 'message', value: '' }]);
    expect(send[0]).toEqual({ $setLocal: 'sending', value: true });
  });
});
