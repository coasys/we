/**
 * Ecosystem interop helpers — raw AD4M/Flux dialect queries the shell feature-detects through
 * `BackendInterop`. The WE-domain space-sync logic that previously lived here moved to the shell
 * (`app-shell/src/shared/spaceSync.ts`): it is model-layer code, not backend dialect.
 */

import { parseLit, type PerspectiveProxy } from '@coasys/ad4m';

export interface FluxSubgroupMessage {
  id: string;
  author: string;
  timestamp: string;
  body: string;
}

/**
 * Flux's ConversationSubgroup has no typed HasMany relation to its items — they're heterogeneous
 * (messages/posts/tasks), linked only via the raw `flux://has_item` predicate and resolved in
 * Flux's own code through ad-hoc SPARQL (see ConversationSubgroup.itemsData() in
 * @coasys/flux-api). The normal $query/include/parent path can't reach them, since it only knows
 * relations registered in the target model's shape. This mirrors that same SPARQL shape directly
 * against the dataset, scoped to messages only, without depending on the flux package. Lives in
 * the adapter because it is raw backend dialect — the shell has no business holding SPARQL.
 */
export async function getFluxSubgroupMessages(dataset: unknown, subgroupId: string): Promise<FluxSubgroupMessage[]> {
  const p = dataset as PerspectiveProxy;
  const sparqlQuery = `
    PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
    SELECT ?id ?author ?timestamp ?body WHERE {
      <${subgroupId}> <flux://has_item> ?id .
      ?_reifier rdf:reifies <<( <${subgroupId}> <flux://has_item> ?id )>> .
      ?_reifier <ad4m://ontology/timestamp> ?timestamp .
      ?id <flux://entry_type> <flux://has_message> .
      ?_typeReifier rdf:reifies <<( ?id <flux://entry_type> <flux://has_message> )>> .
      ?_typeReifier <ad4m://ontology/author> ?author .
      OPTIONAL { ?id <flux://body> ?body . }
    }
    ORDER BY ?timestamp
  `;
  type Binding = { id: string; author: string; timestamp: string; body?: string };
  const result = await p.querySparql<Binding[]>(sparqlQuery);
  return (result || []).map((r) => ({
    id: r.id,
    author: r.author,
    timestamp: r.timestamp,
    body: parseLit(r.body),
  }));
}
