/** Read-only: what the extraction path actually sees. */
import { Ad4mClient } from '@coasys/ad4m';

const PORT = process.env.PORT ?? '12001';
const TOKEN = process.env.TOKEN ?? '';

const client = new Ad4mClient(`http://localhost:${PORT}`, TOKEN, false);

const perspectives = await client.perspective.all();
console.log(`perspectives: ${perspectives.length}`);

for (const p of perspectives) {
  let names: string[] = [];
  try {
    names = await p.getShaclNames();
  } catch {
    continue;
  }
  if (!names.includes('CollectionBlock')) continue;

  const calls = await p.querySparql(`SELECT ?c WHERE { ?c <we://kind> ?k . FILTER(CONTAINS(STR(?k), "call")) }`);
  const rows = Array.isArray(calls) ? calls : [];
  if (!rows.length) continue;

  console.log(`\n=== perspective ${p.uuid} (${p.name}) ===`);
  console.log(
    `shapes: ${names.length}, TaskBlock=${names.includes('TaskBlock')} EventBlock=${names.includes('EventBlock')}`,
  );

  // Do the hints exist on the stored shape?
  const hints = await p.querySparql(
    `SELECT ?targetClass ?hint WHERE {
       ?targetClass <rdf://type> <ad4m://SubjectClass> .
       ?targetClass <ad4m://shape> ?s .
       ?s <ad4m://interpretation_hint> ?hint .
     }`,
  );
  const hintRows = (Array.isArray(hints) ? hints : []) as { targetClass?: string }[];
  console.log(
    `stored class-level hints: ${hintRows.length} ->`,
    hintRows.map((h) => h.targetClass).join(', ') || '(none)',
  );

  for (const row of rows as { c?: string }[]) {
    const callId = row.c;
    if (!callId) continue;
    console.log(`\n-- call ${callId}`);

    // Exactly what gatherTranscriptTurns does.
    const children = await p.querySparql(`SELECT ?child WHERE { <${callId}> <we://children> ?child }`);
    console.log(`   children links: ${Array.isArray(children) ? children.length : 0}`);

    const { getModelForPerspective } = await import('@we/models');
    const Model = getModelForPerspective('TextBlock', p) as
      { findAll: (h: unknown, o: Record<string, unknown>) => Promise<Record<string, unknown>[]> } | undefined;
    if (!Model) {
      console.log('   !! no TextBlock model registered in this process');
      continue;
    }
    const found = await Model.findAll(p, { parent: { id: callId, predicate: 'we://children' } });
    console.log(`   findAll rows: ${found.length}`);
    for (const r of found.slice(0, 3)) {
      console.log(
        `     text=${JSON.stringify(String(r.text ?? '').slice(0, 40))} author=${JSON.stringify(r.author)} createdAt=${JSON.stringify(r.createdAt)}`,
      );
    }
  }
}
