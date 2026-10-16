import { parseLit, type PerspectiveProxy } from '@coasys/ad4m';

/** One message in a Flux conversation subgroup. */
export interface FluxSubgroupMessage {
  id: string;
  author: string;
  timestamp: string;
  body: string;
}

/**
 * The messages in one of Flux's conversation subgroups, oldest first.
 *
 * Flux's `ConversationSubgroup` has no typed relation to its items. They are mixed (messages, posts,
 * tasks), linked only through `flux://has_item`, and Flux reads them with its own SPARQL (see
 * `ConversationSubgroup.itemsData()` in `@coasys/flux-api`). A `$query` only knows relations a
 * model's shape registers, so it cannot reach them. This asks the same question Flux does, for
 * messages only, without depending on Flux's package.
 */
export async function subgroupMessages(dataset: unknown, subgroupId: string): Promise<FluxSubgroupMessage[]> {
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
